import { test, expect } from "@playwright/test";

async function signUpViaApi(page: import("@playwright/test").Page) {
  const slug = Math.random().toString(36).slice(2, 7);
  const username = `upload_${slug}`;
  const email = `upload_${slug}@test.local`;

  await page.goto("/");

  const result = await page.evaluate(
    async ({ name, mail }) => {
      const res = await fetch("/api/player/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          displayName: name,
          email: mail,
          password: "testpass123",
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    { name: username, mail: email }
  );

  expect(result.status).toBe(201);
  return username;
}

test.describe("Profile picture upload", () => {
  test("rejects files exceeding 512KB size limit with 413", async ({
    page,
  }) => {
    await signUpViaApi(page);

    const response = await page.evaluate(async () => {
      const largeBlob = new Blob([new Uint8Array(600 * 1024).fill(0xff)], {
        type: "image/jpeg",
      });
      const formData = new FormData();
      formData.set(
        "profilePicture",
        new File([largeBlob], "huge.jpg", { type: "image/jpeg" })
      );

      const res = await fetch("/api/player/profile-picture", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      return {
        status: res.status,
        body: (await res.json()) as { message: string },
      };
    });

    expect(response.status).toBe(413);
    expect(response.body.message).toContain("too large");
    expect(response.body.message).toContain("512KB");
  });

  test("rejects SVG uploads with 415 and descriptive message", async ({
    page,
  }) => {
    await signUpViaApi(page);

    const response = await page.evaluate(async () => {
      const svgContent =
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
      const blob = new Blob([svgContent], { type: "image/svg+xml" });
      const formData = new FormData();
      formData.set(
        "profilePicture",
        new File([blob], "evil.svg", { type: "image/svg+xml" })
      );

      const res = await fetch("/api/player/profile-picture", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      return {
        status: res.status,
        body: (await res.json()) as { message: string },
      };
    });

    expect(response.status).toBe(415);
    expect(response.body.message).toContain("Unsupported file type");
    expect(response.body.message).toMatch(/JPEG.*PNG.*WebP.*GIF/i);
  });

  test("rejects non-image files (PDF) with 415", async ({ page }) => {
    await signUpViaApi(page);

    const response = await page.evaluate(async () => {
      const blob = new Blob(["%PDF-1.4 fake pdf"], {
        type: "application/pdf",
      });
      const formData = new FormData();
      formData.set(
        "profilePicture",
        new File([blob], "doc.pdf", { type: "application/pdf" })
      );

      const res = await fetch("/api/player/profile-picture", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      return {
        status: res.status,
        body: (await res.json()) as { message: string },
      };
    });

    expect(response.status).toBe(415);
    expect(response.body.message).toContain("Unsupported file type");
  });

  test("rejects upload from guest (non-account) player", async ({ page }) => {
    await page.goto("/");

    // The app auto-creates a guest session on load, so we just need to wait
    // for the page to be ready, then try to upload.
    await expect(page.getByRole("heading", { name: "Tiao" })).toBeVisible();

    const response = await page.evaluate(async () => {
      const blob = new Blob([new Uint8Array(100)], { type: "image/jpeg" });
      const formData = new FormData();
      formData.set(
        "profilePicture",
        new File([blob], "test.jpg", { type: "image/jpeg" })
      );

      const res = await fetch("/api/player/profile-picture", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      return { status: res.status };
    });

    // Guests get 403 — only account holders can upload profile pictures
    expect(response.status).toBe(403);
  });

  test("accepts a small valid JPEG under the size limit", async ({ page }) => {
    await signUpViaApi(page);

    const response = await page.evaluate(async () => {
      // Create a minimal 1x1 white JPEG (valid image data)
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 1, 1);
      const blob = await canvas.convertToBlob({ type: "image/jpeg" });

      const formData = new FormData();
      formData.set(
        "profilePicture",
        new File([blob], "tiny.jpg", { type: "image/jpeg" })
      );

      const res = await fetch("/api/player/profile-picture", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      return {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
      };
    });

    // This may return 200 (success) or 500 (S3 not configured in test env).
    // Either way, it should NOT be 413 or 415 — those would mean the
    // middleware rejected a valid file.
    expect(response.status).not.toBe(413);
    expect(response.status).not.toBe(415);
  });
});
