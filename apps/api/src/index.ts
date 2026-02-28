import bcrypt from "bcryptjs";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { createServer } from "http";
import { Difficulty, Era, MatchStatus, Role } from "@prisma/client";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type AuthTokenPayload,
} from "./lib/auth";
import { prisma } from "./lib/prisma";
import { ensureSeedData } from "./lib/seed";

type EraInput = "90s" | "2000s" | "2010s" | "2020s";
type DifficultyInput = "easy" | "medium" | "hard";

type Player = {
  id: string;
  userId?: string;
  name: string;
  score: number;
  connected: boolean;
};

type RoomSettings = {
  genre?: string;
  studio?: string;
  era?: EraInput;
  questionCount: number;
  timePerQuestionSec: number;
};

type RoomQuestion = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  genre: string;
  studio: string;
  era: EraInput;
  difficulty: DifficultyInput;
};

type Room = {
  id: string;
  hostId: string;
  status: "waiting" | "active" | "finished";
  players: Player[];
  settings: RoomSettings;
  questions: RoomQuestion[];
  currentQuestionIndex: number;
  currentAnswers: Map<string, number>;
  questionEndsAt?: number;
  timerHandle?: NodeJS.Timeout;
  startedAt?: Date;
};

type AuthedRequest = Request & {
  user?: AuthTokenPayload;
};

const PORT = Number(process.env.PORT ?? 4000);
const LEGACY_ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

const rooms = new Map<string, Room>();
const socketToPlayer = new Map<string, { roomId: string; playerId: string }>();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const registerInput = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8).max(128),
});

const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const refreshInput = z.object({
  refreshToken: z.string().min(20),
});

const questionInput = z.object({
  prompt: z.string().min(5),
  options: z.array(z.string().min(1)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  genre: z.string().min(2),
  studio: z.string().min(2),
  era: z.enum(["90s", "2000s", "2010s", "2020s"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

const quizFiltersInput = z.object({
  genre: z.string().optional(),
  studio: z.string().optional(),
  era: z.enum(["90s", "2000s", "2010s", "2020s"]).optional(),
  questionCount: z.number().int().min(3).max(20).default(5),
  timePerQuestionSec: z.number().int().min(5).max(60).default(15),
});

function toEra(input: EraInput): Era {
  switch (input) {
    case "90s":
      return Era.ERA_90S;
    case "2000s":
      return Era.ERA_2000S;
    case "2010s":
      return Era.ERA_2010S;
    case "2020s":
      return Era.ERA_2020S;
    default:
      throw new Error("Invalid era");
  }
}

function fromEra(era: Era): EraInput {
  switch (era) {
    case Era.ERA_90S:
      return "90s";
    case Era.ERA_2000S:
      return "2000s";
    case Era.ERA_2010S:
      return "2010s";
    case Era.ERA_2020S:
      return "2020s";
    default:
      throw new Error("Invalid era");
  }
}

function toDifficulty(input: DifficultyInput): Difficulty {
  switch (input) {
    case "easy":
      return Difficulty.EASY;
    case "medium":
      return Difficulty.MEDIUM;
    case "hard":
      return Difficulty.HARD;
    default:
      throw new Error("Invalid difficulty");
  }
}

function fromDifficulty(difficulty: Difficulty): DifficultyInput {
  switch (difficulty) {
    case Difficulty.EASY:
      return "easy";
    case Difficulty.MEDIUM:
      return "medium";
    case Difficulty.HARD:
      return "hard";
    default:
      throw new Error("Invalid difficulty");
  }
}

function parseQuestionOptions(options: unknown): string[] {
  if (!Array.isArray(options)) {
    return [];
  }
  return options.map((opt) => String(opt));
}

function toRoomQuestion(question: {
  id: string;
  prompt: string;
  options: unknown;
  answerIndex: number;
  genre: string;
  studio: string;
  era: Era;
  difficulty: Difficulty;
}): RoomQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    options: parseQuestionOptions(question.options),
    answerIndex: question.answerIndex,
    genre: question.genre,
    studio: question.studio,
    era: fromEra(question.era),
    difficulty: fromDifficulty(question.difficulty),
  };
}

function sanitizeQuestion(question: RoomQuestion) {
  const { answerIndex, ...rest } = question;
  return rest;
}

function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getLeaderboard(room: Room) {
  return [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({ rank: idx + 1, id: p.id, userId: p.userId, name: p.name, score: p.score, connected: p.connected }));
}

function emitRoomState(io: Server, room: Room) {
  const question = room.questions[room.currentQuestionIndex];
  const remainingSeconds = room.questionEndsAt
    ? Math.max(0, Math.ceil((room.questionEndsAt - Date.now()) / 1000))
    : room.settings.timePerQuestionSec;

  io.to(room.id).emit("room:state", {
    roomId: room.id,
    status: room.status,
    players: room.players,
    settings: room.settings,
    currentQuestionIndex: room.currentQuestionIndex,
    totalQuestions: room.questions.length,
    question: question ? sanitizeQuestion(question) : null,
    remainingSeconds,
  });
}

function parseBearerToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (!auth) {
    return null;
  }
  if (!auth.startsWith("Bearer ")) {
    return null;
  }
  return auth.slice(7).trim();
}

function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = parseBearerToken(req);
  if (!token) {
    res.status(401).json({ message: "Missing bearer token" });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

function adminRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role === "ADMIN") {
    next();
    return;
  }

  if (LEGACY_ADMIN_TOKEN && req.header("x-admin-token") === LEGACY_ADMIN_TOKEN) {
    next();
    return;
  }

  res.status(403).json({ message: "Admin role required" });
}

function userFromAccessToken(token?: string): AuthTokenPayload | null {
  if (!token) {
    return null;
  }
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

async function issueAuthTokens(user: { id: string; role: Role; username: string }) {
  const payload: AuthTokenPayload = {
    sub: user.id,
    role: user.role,
    username: user.username,
  };

  const accessToken = signAccessToken(payload);
  const refreshTokenResult = signRefreshToken(payload);
  const tokenHash = hashToken(refreshTokenResult.token);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: refreshTokenResult.expiresAt,
    },
  });

  return {
    accessToken,
    refreshToken: refreshTokenResult.token,
    user: {
      id: user.id,
      role: user.role,
      username: user.username,
    },
  };
}

async function loadQuestionPool(settings: RoomSettings): Promise<RoomQuestion[]> {
  const pool = await prisma.question.findMany({
    where: {
      genre: settings.genre,
      studio: settings.studio,
      era: settings.era ? toEra(settings.era) : undefined,
    },
  });

  return pool.map(toRoomQuestion);
}

async function persistFinishedMatch(room: Room) {
  const leaderboard = getLeaderboard(room);

  await prisma.match.create({
    data: {
      roomCode: room.id,
      genre: room.settings.genre,
      studio: room.settings.studio,
      era: room.settings.era ? toEra(room.settings.era) : undefined,
      questionCount: room.settings.questionCount,
      timePerQuestionSec: room.settings.timePerQuestionSec,
      status: MatchStatus.FINISHED,
      startedAt: room.startedAt ?? new Date(),
      finishedAt: new Date(),
      participants: {
        create: leaderboard.map((entry) => ({
          userId: entry.userId,
          displayName: entry.name,
          score: entry.score,
          rank: entry.rank,
          connected: entry.connected,
        })),
      },
    },
  });
}

async function finalizeRoom(io: Server, room: Room) {
  room.status = "finished";
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = undefined;
  }

  await persistFinishedMatch(room);

  io.to(room.id).emit("room:ended", {
    leaderboard: getLeaderboard(room),
  });

  emitRoomState(io, room);
}

function advanceQuestion(io: Server, roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.status !== "active") {
    return;
  }

  room.currentQuestionIndex += 1;
  room.currentAnswers.clear();

  if (room.currentQuestionIndex >= room.questions.length) {
    void finalizeRoom(io, room);
    return;
  }

  room.questionEndsAt = Date.now() + room.settings.timePerQuestionSec * 1000;
  emitRoomState(io, room);
  room.timerHandle = setTimeout(() => advanceQuestion(io, roomId), room.settings.timePerQuestionSec * 1000);
}

app.get("/health", async (_req, res) => {
  const userCount = await prisma.user.count();
  const questionCount = await prisma.question.count();

  res.json({ ok: true, timestamp: new Date().toISOString(), db: { userCount, questionCount } });
});

app.post("/api/auth/register", async (req, res) => {
  const parsed = registerInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: parsed.data.email }, { username: parsed.data.username }],
    },
  });

  if (existing) {
    res.status(409).json({ message: "Email or username already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      username: parsed.data.username,
      passwordHash,
      role: Role.PLAYER,
    },
    select: {
      id: true,
      role: true,
      username: true,
    },
  });

  const tokens = await issueAuthTokens(user);
  res.status(201).json(tokens);
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (!user) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordOk) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const tokens = await issueAuthTokens(user);
  res.json(tokens);
});

app.post("/api/auth/refresh", async (req, res) => {
  const parsed = refreshInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  let payload: AuthTokenPayload;
  try {
    payload = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }

  const tokenHash = hashToken(parsed.data.refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    res.status(401).json({ message: "Refresh token expired or revoked" });
    return;
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, username: true },
  });

  if (!user) {
    res.status(401).json({ message: "User not found" });
    return;
  }

  const tokens = await issueAuthTokens(user);
  res.json(tokens);
});

app.get("/api/auth/me", authRequired, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, email: true, username: true, role: true, createdAt: true },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json(user);
});

app.get("/api/profile/me", authRequired, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, email: true, username: true, role: true, createdAt: true },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const participations = await prisma.matchParticipant.findMany({
    where: { userId: user.id },
    include: { match: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const totalMatches = participations.length;
  const totalPoints = participations.reduce((acc: number, p: { score: number }) => acc + p.score, 0);
  const wins = participations.filter((p: { rank: number }) => p.rank === 1).length;

  res.json({
    user,
    stats: {
      totalMatches,
      totalPoints,
      wins,
      avgScore: totalMatches > 0 ? Math.round(totalPoints / totalMatches) : 0,
    },
  });
});

app.get("/api/profile/me/matches", authRequired, async (req: AuthedRequest, res) => {
  const participations = await prisma.matchParticipant.findMany({
    where: { userId: req.user!.sub },
    include: {
      match: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  res.json({
    items: participations.map((p: (typeof participations)[number]) => ({
      id: p.id,
      score: p.score,
      rank: p.rank,
      connected: p.connected,
      displayName: p.displayName,
      match: {
        id: p.match.id,
        roomCode: p.match.roomCode,
        genre: p.match.genre,
        studio: p.match.studio,
        era: p.match.era ? fromEra(p.match.era) : null,
        questionCount: p.match.questionCount,
        timePerQuestionSec: p.match.timePerQuestionSec,
        startedAt: p.match.startedAt,
        finishedAt: p.match.finishedAt,
      },
    })),
  });
});

app.get("/api/questions", async (_req, res) => {
  const items = await prisma.question.findMany({ orderBy: { createdAt: "desc" } });
  res.json({
    items: items.map((q: (typeof items)[number]) => ({
      ...toRoomQuestion(q),
    })),
  });
});

app.post("/api/questions", authRequired, adminRequired, async (req: AuthedRequest, res) => {
  const parsed = questionInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const created = await prisma.question.create({
    data: {
      prompt: parsed.data.prompt,
      options: parsed.data.options,
      answerIndex: parsed.data.answerIndex,
      genre: parsed.data.genre,
      studio: parsed.data.studio,
      era: toEra(parsed.data.era),
      difficulty: toDifficulty(parsed.data.difficulty),
      createdById: req.user?.sub,
    },
  });

  res.status(201).json(toRoomQuestion(created));
});

app.put("/api/questions/:id", authRequired, adminRequired, async (req, res) => {
  const parsed = questionInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ message: "Question not found" });
    return;
  }

  const updated = await prisma.question.update({
    where: { id: req.params.id },
    data: {
      prompt: parsed.data.prompt,
      options: parsed.data.options,
      answerIndex: parsed.data.answerIndex,
      genre: parsed.data.genre,
      studio: parsed.data.studio,
      era: toEra(parsed.data.era),
      difficulty: toDifficulty(parsed.data.difficulty),
    },
  });

  res.json(toRoomQuestion(updated));
});

app.delete("/api/questions/:id", authRequired, adminRequired, async (req, res) => {
  const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ message: "Question not found" });
    return;
  }

  await prisma.question.delete({ where: { id: req.params.id } });
  res.json({ deleted: req.params.id });
});

app.get("/api/rankings", async (_req, res) => {
  const participants = await prisma.matchParticipant.findMany({
    where: {
      match: {
        status: MatchStatus.FINISHED,
      },
    },
    select: {
      displayName: true,
      score: true,
    },
  });

  const scores = new Map<string, number>();
  for (const row of participants) {
    scores.set(row.displayName, (scores.get(row.displayName) ?? 0) + row.score);
  }

  const items = [...scores.entries()]
    .map(([player, points]) => ({ player, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 50);

  res.json({ items });
});

app.post("/api/quizzes/single", async (req, res) => {
  const parsed = quizFiltersInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const pool = await loadQuestionPool(parsed.data);
  if (pool.length < parsed.data.questionCount) {
    res.status(400).json({ message: `Not enough questions for these filters. Available: ${pool.length}` });
    return;
  }

  const picked = shuffled(pool).slice(0, parsed.data.questionCount);
  res.json({
    settings: parsed.data,
    questions: picked.map(sanitizeQuestion),
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  socket.on(
    "room:create",
    async (
      payload: { hostName: string; settings: RoomSettings; accessToken?: string },
      ack?: (result: { ok: boolean; message?: string; roomId?: string; playerId?: string }) => void,
    ) => {
      try {
        const roomId = uuidv4().slice(0, 6).toUpperCase();
        const playerId = uuidv4();
        const settings = quizFiltersInput.parse(payload.settings);
        const tokenUser = userFromAccessToken(payload.accessToken);

        const room: Room = {
          id: roomId,
          hostId: playerId,
          status: "waiting",
          players: [
            {
              id: playerId,
              userId: tokenUser?.sub,
              name: payload.hostName || tokenUser?.username || "Host",
              score: 0,
              connected: true,
            },
          ],
          settings,
          questions: [],
          currentQuestionIndex: 0,
          currentAnswers: new Map(),
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socketToPlayer.set(socket.id, { roomId, playerId });

        emitRoomState(io, room);
        ack?.({ ok: true, roomId, playerId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create room";
        ack?.({ ok: false, message });
      }
    },
  );

  socket.on(
    "room:join",
    (
      payload: { roomId: string; playerName: string; accessToken?: string },
      ack?: (result: { ok: boolean; message?: string; roomId?: string; playerId?: string }) => void,
    ) => {
      const room = rooms.get(payload.roomId.toUpperCase());
      if (!room) {
        ack?.({ ok: false, message: "Room not found" });
        return;
      }

      if (room.status !== "waiting") {
        ack?.({ ok: false, message: "Room already started" });
        return;
      }

      const tokenUser = userFromAccessToken(payload.accessToken);
      const playerId = uuidv4();
      room.players.push({
        id: playerId,
        userId: tokenUser?.sub,
        name: payload.playerName || tokenUser?.username || "Player",
        score: 0,
        connected: true,
      });

      socket.join(room.id);
      socketToPlayer.set(socket.id, { roomId: room.id, playerId });

      emitRoomState(io, room);
      ack?.({ ok: true, roomId: room.id, playerId });
    },
  );

  socket.on(
    "room:start",
    async (payload: { roomId: string; playerId: string }, ack?: (result: { ok: boolean; message?: string }) => void) => {
      const room = rooms.get(payload.roomId.toUpperCase());
      if (!room) {
        ack?.({ ok: false, message: "Room not found" });
        return;
      }

      if (room.hostId !== payload.playerId) {
        ack?.({ ok: false, message: "Only host can start" });
        return;
      }

      const pool = await loadQuestionPool(room.settings);
      if (pool.length < room.settings.questionCount) {
        ack?.({ ok: false, message: `Not enough questions for selected filters. Available: ${pool.length}` });
        return;
      }

      room.questions = shuffled(pool).slice(0, room.settings.questionCount);
      room.currentQuestionIndex = 0;
      room.currentAnswers.clear();
      room.status = "active";
      room.startedAt = new Date();
      room.questionEndsAt = Date.now() + room.settings.timePerQuestionSec * 1000;

      emitRoomState(io, room);
      room.timerHandle = setTimeout(() => advanceQuestion(io, room.id), room.settings.timePerQuestionSec * 1000);
      ack?.({ ok: true });
    },
  );

  socket.on(
    "room:answer",
    (
      payload: { roomId: string; playerId: string; answerIndex: number },
      ack?: (result: { ok: boolean; correct?: boolean; points?: number; message?: string }) => void,
    ) => {
      const room = rooms.get(payload.roomId.toUpperCase());
      if (!room || room.status !== "active") {
        ack?.({ ok: false, message: "Room not active" });
        return;
      }

      const question = room.questions[room.currentQuestionIndex];
      if (!question) {
        ack?.({ ok: false, message: "Question unavailable" });
        return;
      }

      if (room.currentAnswers.has(payload.playerId)) {
        ack?.({ ok: false, message: "Already answered" });
        return;
      }

      room.currentAnswers.set(payload.playerId, payload.answerIndex);
      const player = room.players.find((p) => p.id === payload.playerId);
      if (!player) {
        ack?.({ ok: false, message: "Player not found" });
        return;
      }

      const correct = payload.answerIndex === question.answerIndex;
      let points = 0;
      if (correct && room.questionEndsAt) {
        const timeBonus = Math.max(0, Math.floor((room.questionEndsAt - Date.now()) / 250));
        points = 100 + timeBonus;
        player.score += points;
      }

      emitRoomState(io, room);
      ack?.({ ok: true, correct, points });
    },
  );

  socket.on("disconnect", () => {
    const mapped = socketToPlayer.get(socket.id);
    if (!mapped) {
      return;
    }

    const room = rooms.get(mapped.roomId);
    if (!room) {
      socketToPlayer.delete(socket.id);
      return;
    }

    const player = room.players.find((p) => p.id === mapped.playerId);
    if (player) {
      player.connected = false;
    }

    emitRoomState(io, room);
    socketToPlayer.delete(socket.id);
  });
});

async function start() {
  await prisma.$connect();
  await ensureSeedData();

  httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
