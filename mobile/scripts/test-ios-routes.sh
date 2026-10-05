#!/usr/bin/env bash
# Compile ios/App/App/TiaoRoutes.swift on its own and check it against
# scripts/routes-cases.txt (the same fixture the Android unit test uses).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v swiftc >/dev/null || { echo 'swiftc not found; skipping iOS route tests.'; exit 0; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/main.swift" <<'SWIFT'
import Foundation
let text = try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
var files = Set<String>()
var cases: [(String, String)] = []
for line in text.split(separator: "\n") {
    let parts = line.split(separator: " ").map(String.init)
    if parts.first == "F" { files.insert(parts[1]) }
    if parts.first == "C" { cases.append((parts[1], parts[2])) }
}
var failures = 0
for (input, expected) in cases {
    let actual = TiaoRoutes.resolve(input) { files.contains($0) }
    if actual != expected {
        failures += 1
        print("FAIL \(input): expected \(expected), got \(actual)")
    }
}
print("\(cases.count - failures)/\(cases.count) iOS route cases passed")
exit(failures == 0 ? 0 : 1)
SWIFT
swiftc -O -o "$work/routes" ios/App/App/TiaoRoutes.swift "$work/main.swift"
"$work/routes" scripts/routes-cases.txt
