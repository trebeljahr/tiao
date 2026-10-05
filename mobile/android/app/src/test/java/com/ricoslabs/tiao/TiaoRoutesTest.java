package com.ricoslabs.tiao;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

/** Checks the route mapper against the fixture shared with the iOS router. */
public class TiaoRoutesTest {

    @Test
    public void matchesSharedRouteCases() throws IOException {
        // Gradle runs unit tests from android/app; the fixture lives in mobile/scripts.
        Path fixture = Paths.get("..", "..", "scripts", "routes-cases.txt");
        Set<String> files = new HashSet<>();
        List<String[]> cases = new ArrayList<>();
        for (String line : Files.readAllLines(fixture, StandardCharsets.UTF_8)) {
            String[] parts = line.split(" ");
            if (parts[0].equals("F")) files.add(parts[1]);
            if (parts[0].equals("C")) cases.add(new String[] { parts[1], parts[2] });
        }
        assertTrue("fixture has cases", cases.size() > 20);
        for (String[] c : cases) {
            assertEquals(c[0], c[1], TiaoRoutes.resolve(c[0], files::contains));
        }
    }

    @Test
    public void emptyPathServesTheRootShell() {
        assertEquals("/index.html", TiaoRoutes.resolve("", (p) -> false));
        assertEquals("/index.html", TiaoRoutes.resolve(null, (p) -> false));
    }
}
