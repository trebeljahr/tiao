import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthResponse } from "@shared";
import { Navbar, type AuthDialogMode } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getAccountProfile,
  type AccountProfile,
  updateAccountProfile,
  uploadAccountProfilePicture,
} from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";

type ProfilePageProps = {
  auth: AuthResponse | null;
  onAuthChange: (auth: AuthResponse) => void;
  onOpenAuth: (mode: AuthDialogMode) => void;
  onLogout: () => void;
};

function formatTimestamp(value?: string) {
  if (!value) {
    return "Just now";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ProfilePage({
  auth,
  onAuthChange,
  onOpenAuth,
  onLogout,
}: ProfilePageProps) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (auth?.player.kind !== "account") {
      setLoading(false);
      return;
    }

    const token = auth.token;
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setPageError(null);

      try {
        const response = await getAccountProfile(token);
        if (cancelled) {
          return;
        }

        setProfile(response.profile);
        setDisplayName(response.profile.displayName);
        setEmail(response.profile.email);
      } catch (error) {
        if (!cancelled) {
          if (isNetworkError(error)) {
            toastError(error);
          } else {
            setPageError(readableError(error));
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [auth]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  useEffect(() => {
    if (!successMessage) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 2400);

    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    if (!pageError) {
      return;
    }

    toastError(pageError);
    setPageError(null);
  }, [pageError]);

  async function handleSaveProfile() {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    setSaving(true);
    setPageError(null);

    try {
      const response = await updateAccountProfile(auth.token, {
        displayName,
        email,
      });
      onAuthChange(response.auth);
      setProfile(response.profile);
      setDisplayName(response.profile.displayName);
      setEmail(response.profile.email);
      setSuccessMessage("Profile saved.");
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setPageError(readableError(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadPicture() {
    if (!auth || auth.player.kind !== "account" || !selectedFile) {
      return;
    }

    setUploading(true);
    setPageError(null);

    try {
      const response = await uploadAccountProfilePicture(auth.token, selectedFile);
      onAuthChange(response.auth);
      setProfile(response.profile);
      setSelectedFile(null);
      setSuccessMessage("Profile picture updated.");
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setPageError(readableError(error));
      }
    } finally {
      setUploading(false);
    }
  }

  const profileImage = previewUrl || profile?.profilePicture;
  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,232,0.76),_transparent_62%)]" />

      <Navbar
        mode="profile"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((value) => !value)}
        onCloseNav={() => setNavOpen(false)}
        onGoLobby={() => navigate("/")}
        onGoMultiplayer={() => navigate("/?view=multiplayer")}
        onGoOverTheBoard={() => navigate("/?view=over-the-board")}
        onGoLocal={() => navigate("/?view=local")}
        onGoProfile={() => {
          setNavOpen(false);
          navigate("/profile");
        }}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        {auth?.player.kind !== "account" ? (
          <Card className={paperCard}>
            <CardHeader>
              <CardTitle>Account profile</CardTitle>
              <CardDescription>
                Save a display name, email, and profile picture on the server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                Guest sessions are great for quick matches, but server-backed
                profiles need a full account.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => onOpenAuth("signup")}>Create account</Button>
                <Button variant="outline" onClick={() => onOpenAuth("login")}>
                  Sign in
                </Button>
                <Button variant="ghost" onClick={() => navigate("/")}>
                  Back to lobby
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {auth?.player.kind === "account" ? (
          <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>Picture</CardTitle>
                <CardDescription>
                  Upload a profile image that follows you around the app.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="mx-auto flex h-56 w-56 items-center justify-center overflow-hidden rounded-[2rem] border border-[#d4bd94] bg-[linear-gradient(180deg,#fbf2de,#ead5aa)] shadow-[0_24px_60px_-38px_rgba(58,35,16,0.6)]">
                  {profileImage ? (
                    <img
                      src={profileImage}
                      alt={displayName || auth.player.displayName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="font-display text-7xl text-[#2d2016]">
                      {(displayName || auth.player.displayName).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>

                <label className="grid gap-2 text-sm font-medium text-[#4e3d2c]">
                  <span>Choose image</span>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      setSelectedFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>

                <Button
                  className="w-full"
                  onClick={handleUploadPicture}
                  disabled={!selectedFile || uploading}
                >
                  {uploading ? "Uploading..." : "Upload profile picture"}
                </Button>
              </CardContent>
            </Card>

            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>Basic info</CardTitle>
                <CardDescription>
                  Keep your game identity polished without leaving the app.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                    Loading your saved profile...
                  </div>
                ) : (
                  <>
                    <label className="grid gap-2 text-sm font-medium text-[#4e3d2c]">
                      <span>Display name</span>
                      <Input
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder="Display name"
                      />
                    </label>

                    <label className="grid gap-2 text-sm font-medium text-[#4e3d2c]">
                      <span>Email</span>
                      <Input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="Email"
                      />
                    </label>

                    <div className="grid gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                      <p>Created: {formatTimestamp(profile?.createdAt)}</p>
                      <p>Updated: {formatTimestamp(profile?.updatedAt)}</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button onClick={handleSaveProfile} disabled={saving}>
                        {saving ? "Saving..." : "Save changes"}
                      </Button>
                      <Button variant="outline" onClick={() => navigate("/")}>
                        Back to lobby
                      </Button>
                    </div>
                  </>
                )}

                {successMessage ? (
                  <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {successMessage}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    </div>
  );
}
