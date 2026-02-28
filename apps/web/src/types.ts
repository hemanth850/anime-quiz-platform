export type Era = "90s" | "2000s" | "2010s" | "2020s";

export type Question = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  genre: string;
  studio: string;
  era: Era;
  difficulty: "easy" | "medium" | "hard";
};

export type RoomState = {
  roomId: string;
  status: "waiting" | "active" | "finished";
  players: Array<{ id: string; name: string; score: number; connected: boolean }>;
  settings: {
    genre?: string;
    studio?: string;
    era?: Era;
    mode: "casual" | "ranked";
    seasonId?: string;
    questionCount: number;
    timePerQuestionSec: number;
  };
  currentQuestionIndex: number;
  totalQuestions: number;
  question: Omit<Question, "answerIndex"> | null;
  remainingSeconds: number;
  spectators: number;
};

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
