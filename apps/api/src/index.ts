import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

type Era = "90s" | "2000s" | "2010s" | "2020s";

type Question = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  genre: string;
  studio: string;
  era: Era;
  difficulty: "easy" | "medium" | "hard";
};

type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
};

type RoomSettings = {
  genre?: string;
  studio?: string;
  era?: Era;
  questionCount: number;
  timePerQuestionSec: number;
};

type Room = {
  id: string;
  hostId: string;
  status: "waiting" | "active" | "finished";
  players: Player[];
  settings: RoomSettings;
  questions: Question[];
  currentQuestionIndex: number;
  currentAnswers: Map<string, number>;
  questionEndsAt?: number;
  timerHandle?: NodeJS.Timeout;
};

type Ranking = {
  player: string;
  points: number;
};

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const PORT = Number(process.env.PORT ?? 4000);

const questions: Question[] = [
  {
    id: uuidv4(),
    prompt: "Which studio produced Attack on Titan (Season 1)?",
    options: ["Madhouse", "Wit Studio", "MAPPA", "Bones"],
    answerIndex: 1,
    genre: "Action",
    studio: "Wit Studio",
    era: "2010s",
    difficulty: "easy",
  },
  {
    id: uuidv4(),
    prompt: "Who is known as Fullmetal Alchemist?",
    options: ["Roy Mustang", "Alphonse Elric", "Edward Elric", "Maes Hughes"],
    answerIndex: 2,
    genre: "Action",
    studio: "Bones",
    era: "2000s",
    difficulty: "easy",
  },
  {
    id: uuidv4(),
    prompt: "Which anime is set in the city of Academy City?",
    options: ["Steins;Gate", "A Certain Scientific Railgun", "Psycho-Pass", "Ergo Proxy"],
    answerIndex: 1,
    genre: "Sci-Fi",
    studio: "J.C.Staff",
    era: "2010s",
    difficulty: "medium",
  },
  {
    id: uuidv4(),
    prompt: "What is the name of the pirate crew led by Luffy?",
    options: ["Red Hair Pirates", "Heart Pirates", "Straw Hat Pirates", "Whitebeard Pirates"],
    answerIndex: 2,
    genre: "Adventure",
    studio: "Toei Animation",
    era: "2000s",
    difficulty: "easy",
  },
  {
    id: uuidv4(),
    prompt: "Which studio animated Demon Slayer?",
    options: ["ufotable", "Kyoto Animation", "Trigger", "CloverWorks"],
    answerIndex: 0,
    genre: "Action",
    studio: "ufotable",
    era: "2020s",
    difficulty: "easy",
  },
  {
    id: uuidv4(),
    prompt: "In Neon Genesis Evangelion, what is Unit-01 primarily piloted by?",
    options: ["Rei Ayanami", "Asuka Langley", "Shinji Ikari", "Misato Katsuragi"],
    answerIndex: 2,
    genre: "Mecha",
    studio: "Gainax",
    era: "90s",
    difficulty: "medium",
  },
];

const rankings = new Map<string, number>();
const rooms = new Map<string, Room>();
const socketToPlayer = new Map<string, { roomId: string; playerId: string }>();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

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

function isAdmin(req: express.Request): boolean {
  return req.header("x-admin-token") === ADMIN_TOKEN;
}

function sanitizeQuestion(question: Question) {
  const { answerIndex, ...rest } = question;
  return rest;
}

function filterQuestions(settings: RoomSettings): Question[] {
  return questions.filter((q) => {
    if (settings.genre && q.genre.toLowerCase() !== settings.genre.toLowerCase()) {
      return false;
    }
    if (settings.studio && q.studio.toLowerCase() !== settings.studio.toLowerCase()) {
      return false;
    }
    if (settings.era && q.era !== settings.era) {
      return false;
    }
    return true;
  });
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
    .map((p, idx) => ({ rank: idx + 1, name: p.name, score: p.score }));
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

function finalizeRoom(io: Server, room: Room) {
  room.status = "finished";
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = undefined;
  }

  for (const player of room.players) {
    rankings.set(player.name, (rankings.get(player.name) ?? 0) + player.score);
  }

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
    finalizeRoom(io, room);
    return;
  }

  room.questionEndsAt = Date.now() + room.settings.timePerQuestionSec * 1000;
  emitRoomState(io, room);
  room.timerHandle = setTimeout(() => advanceQuestion(io, roomId), room.settings.timePerQuestionSec * 1000);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/questions", (_req, res) => {
  res.json({ items: questions });
});

app.post("/api/questions", (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = questionInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const newQuestion: Question = {
    id: uuidv4(),
    ...parsed.data,
  };
  questions.push(newQuestion);
  res.status(201).json(newQuestion);
});

app.put("/api/questions/:id", (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = questionInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const idx = questions.findIndex((q) => q.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ message: "Question not found" });
    return;
  }

  questions[idx] = { id: req.params.id, ...parsed.data };
  res.json(questions[idx]);
});

app.delete("/api/questions/:id", (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const idx = questions.findIndex((q) => q.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ message: "Question not found" });
    return;
  }

  const [deleted] = questions.splice(idx, 1);
  res.json({ deleted });
});

app.get("/api/rankings", (_req, res) => {
  const board = [...rankings.entries()]
    .map(([player, points]) => ({ player, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 50);
  res.json({ items: board });
});

app.post("/api/quizzes/single", (req, res) => {
  const parsed = quizFiltersInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const pool = filterQuestions(parsed.data);
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
  socket.on("room:create", (payload: { hostName: string; settings: RoomSettings }, ack?: (result: unknown) => void) => {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    const playerId = uuidv4();
    const settings = quizFiltersInput.parse(payload.settings);

    const room: Room = {
      id: roomId,
      hostId: playerId,
      status: "waiting",
      players: [{ id: playerId, name: payload.hostName || "Host", score: 0, connected: true }],
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
  });

  socket.on("room:join", (payload: { roomId: string; playerName: string }, ack?: (result: unknown) => void) => {
    const room = rooms.get(payload.roomId.toUpperCase());
    if (!room) {
      ack?.({ ok: false, message: "Room not found" });
      return;
    }

    if (room.status !== "waiting") {
      ack?.({ ok: false, message: "Room already started" });
      return;
    }

    const playerId = uuidv4();
    room.players.push({ id: playerId, name: payload.playerName || "Player", score: 0, connected: true });

    socket.join(room.id);
    socketToPlayer.set(socket.id, { roomId: room.id, playerId });

    emitRoomState(io, room);
    ack?.({ ok: true, roomId: room.id, playerId });
  });

  socket.on("room:start", (payload: { roomId: string; playerId: string }, ack?: (result: unknown) => void) => {
    const room = rooms.get(payload.roomId.toUpperCase());
    if (!room) {
      ack?.({ ok: false, message: "Room not found" });
      return;
    }

    if (room.hostId !== payload.playerId) {
      ack?.({ ok: false, message: "Only host can start" });
      return;
    }

    const pool = filterQuestions(room.settings);
    if (pool.length < room.settings.questionCount) {
      ack?.({ ok: false, message: `Not enough questions for selected filters. Available: ${pool.length}` });
      return;
    }

    room.questions = shuffled(pool).slice(0, room.settings.questionCount);
    room.currentQuestionIndex = 0;
    room.currentAnswers.clear();
    room.status = "active";
    room.questionEndsAt = Date.now() + room.settings.timePerQuestionSec * 1000;

    emitRoomState(io, room);
    room.timerHandle = setTimeout(() => advanceQuestion(io, room.id), room.settings.timePerQuestionSec * 1000);
    ack?.({ ok: true });
  });

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

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API running on http://localhost:${PORT}`);
});
