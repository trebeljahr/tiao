type TimeControl = { initialMs: number; incrementMs: number };

export type GameOgData = {
  gameId: string;
  status: string;
  boardSize: number;
  scoreToWin: number;
  score: { white: number; black: number };
  white: string | null;
  black: string | null;
  whiteRating?: number;
  blackRating?: number;
  timeControl: TimeControl | null;
  roomType: string;
};

export type PublicProfileSeoData = {
  displayName: string;
  profilePicture?: string;
  rating?: number;
  gamesPlayed?: number;
  gamesWon?: number;
  gamesLost?: number;
};

export type PublicTournamentSeoData = {
  name: string;
  settings: { format: string };
  participants: unknown[];
};

export type PublicTournamentListItem = {
  tournamentId: string;
  name: string;
  status: string;
  playerCount: number;
  maxPlayers: number;
  isFeatured: boolean;
  createdAt: string;
};

function apiBaseUrl(): string | null {
  if (process.env.API_URL) return process.env.API_URL;
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;
  if (process.env.NODE_ENV === "development") {
    return `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
  }

  return null;
}

async function fetchPublicApi<T>(path: string, revalidate: number): Promise<T | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return null;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchGameOg(gameId: string): Promise<GameOgData | null> {
  return fetchPublicApi<GameOgData>(`/api/games/${encodeURIComponent(gameId)}/og`, 30);
}

export async function fetchPublicProfile(username: string): Promise<PublicProfileSeoData | null> {
  const data = await fetchPublicApi<{ profile: PublicProfileSeoData }>(
    `/api/player/profile/${encodeURIComponent(username)}`,
    120,
  );
  return data?.profile ?? null;
}

export async function fetchTournament(
  tournamentId: string,
): Promise<PublicTournamentSeoData | null> {
  const data = await fetchPublicApi<{ tournament: PublicTournamentSeoData }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}`,
    60,
  );
  return data?.tournament ?? null;
}

export async function fetchPublicTournaments(): Promise<PublicTournamentListItem[]> {
  const data = await fetchPublicApi<{ tournaments: PublicTournamentListItem[] }>(
    "/api/tournaments",
    300,
  );
  return data?.tournaments ?? [];
}
