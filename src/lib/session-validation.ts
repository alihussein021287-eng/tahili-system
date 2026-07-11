export class SessionStoreUnavailableError extends Error {
  readonly code = "SESSION_STORE_UNAVAILABLE";

  constructor() {
    super("تعذر التحقق من الجلسة");
    this.name = "SessionStoreUnavailableError";
  }
}

export type SessionUserRecord = {
  id: string;
  fullName: string;
  role: string;
  isActive: boolean;
  needsActivation: boolean;
  authVersion: number;
};

type SessionLike = {
  user?: {
    id?: string;
    name?: string | null;
    role?: string;
    authVersion?: number;
  } | null;
};

export async function validateCurrentSession<T extends SessionLike>(
  session: T | null,
  findUser: (id: string) => Promise<SessionUserRecord | null>,
): Promise<T | null> {
  const uid = session?.user?.id;
  const tokenAuthVersion = session?.user?.authVersion;
  if (!uid || !Number.isInteger(tokenAuthVersion)) return null;

  let user: SessionUserRecord | null;
  try {
    user = await findUser(uid);
  } catch {
    throw new SessionStoreUnavailableError();
  }

  if (!user || !user.isActive || user.needsActivation || user.authVersion !== tokenAuthVersion) {
    return null;
  }

  return {
    ...session,
    user: {
      ...session.user,
      id: user.id,
      name: user.fullName,
      role: user.role,
      authVersion: user.authVersion,
    },
  };
}
