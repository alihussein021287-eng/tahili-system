import "next-auth";
declare module "next-auth" {
  interface Session { user: { id?: string; name?: string | null; role?: string; authVersion?: number } }
  interface User { role?: string; authVersion?: number }
}
declare module "next-auth/jwt" {
  interface JWT { role?: string; uid?: string; authVersion?: number }
}
