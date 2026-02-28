import bcrypt from "bcryptjs";
import { Difficulty, Era, Role } from "@prisma/client";
import { prisma } from "./prisma";

const initialQuestions = [
  {
    prompt: "Which studio produced Attack on Titan (Season 1)?",
    options: ["Madhouse", "Wit Studio", "MAPPA", "Bones"],
    answerIndex: 1,
    genre: "Action",
    studio: "Wit Studio",
    era: Era.ERA_2010S,
    difficulty: Difficulty.EASY,
  },
  {
    prompt: "Who is known as Fullmetal Alchemist?",
    options: ["Roy Mustang", "Alphonse Elric", "Edward Elric", "Maes Hughes"],
    answerIndex: 2,
    genre: "Action",
    studio: "Bones",
    era: Era.ERA_2000S,
    difficulty: Difficulty.EASY,
  },
  {
    prompt: "Which anime is set in the city of Academy City?",
    options: ["Steins;Gate", "A Certain Scientific Railgun", "Psycho-Pass", "Ergo Proxy"],
    answerIndex: 1,
    genre: "Sci-Fi",
    studio: "J.C.Staff",
    era: Era.ERA_2010S,
    difficulty: Difficulty.MEDIUM,
  },
  {
    prompt: "Which studio animated Demon Slayer?",
    options: ["ufotable", "Kyoto Animation", "Trigger", "CloverWorks"],
    answerIndex: 0,
    genre: "Action",
    studio: "ufotable",
    era: Era.ERA_2020S,
    difficulty: Difficulty.EASY,
  },
  {
    prompt: "In Neon Genesis Evangelion, what is Unit-01 primarily piloted by?",
    options: ["Rei Ayanami", "Asuka Langley", "Shinji Ikari", "Misato Katsuragi"],
    answerIndex: 2,
    genre: "Mecha",
    studio: "Gainax",
    era: Era.ERA_90S,
    difficulty: Difficulty.MEDIUM,
  },
];

export async function ensureSeedData(): Promise<void> {
  const activeSeason = await prisma.season.findFirst({
    where: { isActive: true },
  });

  if (!activeSeason) {
    await prisma.season.create({
      data: {
        code: "S1-2026",
        name: "Season 1 2026",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        isActive: true,
      },
    });
  }

  const questionCount = await prisma.question.count();
  if (questionCount === 0) {
    await prisma.question.createMany({
      data: initialQuestions,
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminUsername = process.env.SEED_ADMIN_USERNAME;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (adminEmail && adminUsername && adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await prisma.user.create({
        data: {
          email: adminEmail,
          username: adminUsername,
          passwordHash,
          role: Role.ADMIN,
        },
      });
    }
  }
}
