# Tiao API Reference

Complete REST API and WebSocket protocol reference for Tiao.

## Authentication

All endpoints require a `tiao.session` HttpOnly cookie, set automatically by the guest, signup, and login endpoints. Endpoints return `401` if no valid session is present. Social and profile endpoints additionally return `403` if the player is a guest (account required).

---

## Player Authentication

### POST /api/player/guest

Create a guest session.

**Request:**

```json
{
  "displayName": "Player1"
}
```

All fields are optional. A display name is generated if omitted.

**Response 201:**

```json
{
  "player": {
    "playerId": "abc123",
    "displayName": "Player1",
    "kind": "guest"
  }
}
```

Sets the `tiao.session` HttpOnly cookie.

---

### POST /api/player/signup

Create an account.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "securepass",
  "displayName": "MyName"
}
```

Only `password` is required. `email` and `displayName` are optional.

**Response 201:**

```json
{
  "player": {
    "playerId": "abc123",
    "displayName": "MyName",
    "kind": "account",
    "email": "user@example.com"
  }
}
```

Sets the `tiao.session` HttpOnly cookie.

**Errors:**

| Status | Reason                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------- |
| 400    | Missing password, password too short (<8 chars), display name too short (<3 chars), invalid email format |
| 409    | Email or username already taken                                                                          |
| 503    | Database unavailable                                                                                     |

---

### POST /api/player/login

Login to an existing account.

**Request:**

```json
{
  "identifier": "user@example.com",
  "password": "securepass"
}
```

`identifier` can be an email address or a username.

**Response 200:**

```json
{
  "player": {
    "playerId": "abc123",
    "displayName": "MyName",
    "kind": "account",
    "email": "user@example.com"
  }
}
```

Sets the `tiao.session` HttpOnly cookie.

**Errors:**

| Status | Reason                            |
| ------ | --------------------------------- |
| 400    | Missing identifier or password    |
| 401    | Account not found, wrong password |
| 503    | Database unavailable              |

---

### POST /api/player/logout

Destroy the current session.

**Response 204:** No body.

---

### GET /api/player/me

Get the current authenticated player.

**Response 200:**

```json
{
  "player": {
    "playerId": "abc123",
    "displayName": "MyName",
    "kind": "account",
    "email": "user@example.com",
    "profilePicture": "https://..."
  }
}
```

**Errors:**

| Status | Reason            |
| ------ | ----------------- |
| 401    | Not authenticated |

---

## Player Profile

Account-only endpoints. Guests receive `403`.

### GET /api/player/profile

Get account profile.

**Response 200:**

```json
{
  "profile": {
    "displayName": "MyName",
    "email": "user@example.com",
    "profilePicture": "https://...",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-02-20T14:00:00.000Z"
  }
}
```

**Errors:**

| Status | Reason                |
| ------ | --------------------- |
| 401    | Not authenticated     |
| 403    | Not an account player |
| 404    | Account not found     |

---

### PUT /api/player/profile

Update account profile. All fields are optional, but at least one must be provided.

**Request:**

```json
{
  "displayName": "NewName",
  "email": "new@example.com",
  "password": "newsecurepass"
}
```

**Response 200:**

```json
{
  "auth": {
    "player": {
      "playerId": "abc123",
      "displayName": "NewName",
      "kind": "account",
      "email": "new@example.com"
    }
  },
  "profile": {
    "displayName": "NewName",
    "email": "new@example.com",
    "profilePicture": "https://...",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-03-01T09:00:00.000Z"
  }
}
```

**Errors:**

| Status | Reason                                                                       |
| ------ | ---------------------------------------------------------------------------- |
| 400    | Nothing to update, display name too short, password too short, invalid email |
| 409    | Username or email already taken                                              |

---

### POST /api/player/profile-picture

Upload a profile picture. Expects `multipart/form-data` with a field named `profilePicture`.

**Request:**

```
Content-Type: multipart/form-data
Field: profilePicture (file)
```

**Response 200:**

```json
{
  "auth": {
    "player": {
      "playerId": "abc123",
      "displayName": "MyName",
      "kind": "account",
      "profilePicture": "https://..."
    }
  },
  "profile": {
    "displayName": "MyName",
    "email": "user@example.com",
    "profilePicture": "https://...",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-03-01T09:00:00.000Z"
  }
}
```

**Errors:**

| Status | Reason           |
| ------ | ---------------- |
| 400    | No file uploaded |

---

## Games

### GET /api/games

List the authenticated player's games. Account only.

**Response 200:**

```json
{
  "games": {
    "active": [
      {
        "gameId": "ABC123",
        "roomType": "direct",
        "status": "active",
        "createdAt": "2025-03-01T12:00:00.000Z",
        "updatedAt": "2025-03-01T12:05:00.000Z",
        "currentTurn": "white",
        "historyLength": 4,
        "winner": null,
        "yourSeat": "white",
        "score": { "white": 2, "black": 2 },
        "players": [
          {
            "player": { "playerId": "abc123", "displayName": "Alice", "kind": "account" },
            "online": true
          },
          {
            "player": { "playerId": "def456", "displayName": "Bob", "kind": "account" },
            "online": false
          }
        ],
        "seats": {
          "white": {
            "player": { "playerId": "abc123", "displayName": "Alice", "kind": "account" },
            "online": true
          },
          "black": {
            "player": { "playerId": "def456", "displayName": "Bob", "kind": "account" },
            "online": false
          }
        }
      }
    ],
    "finished": []
  }
}
```

---

### POST /api/games

Create a new game room.

**Request:** No body required.

**Response 201:**

```json
{
  "snapshot": {
    "gameId": "XYZ789",
    "roomType": "direct",
    "status": "waiting",
    "createdAt": "2025-03-01T12:00:00.000Z",
    "updatedAt": "2025-03-01T12:00:00.000Z",
    "state": { "...": "full board state" },
    "players": [
      {
        "player": { "playerId": "abc123", "displayName": "Alice", "kind": "account" },
        "online": false
      }
    ],
    "rematch": null,
    "seats": {
      "white": {
        "player": { "playerId": "abc123", "displayName": "Alice", "kind": "account" },
        "online": false
      },
      "black": null
    }
  }
}
```

---

### GET /api/games/:gameId

Get a game snapshot.

**Response 200:**

```json
{
  "snapshot": {
    "gameId": "XYZ789",
    "roomType": "direct",
    "status": "active",
    "createdAt": "2025-03-01T12:00:00.000Z",
    "updatedAt": "2025-03-01T12:10:00.000Z",
    "state": { "...": "full board state" },
    "players": [],
    "rematch": null,
    "seats": { "white": null, "black": null }
  }
}
```

**Errors:**

| Status | Reason         |
| ------ | -------------- |
| 404    | Game not found |

---

### POST /api/games/:gameId/join

Join an existing game room by taking an available seat.

**Response 200:**

```json
{
  "snapshot": { "...": "MultiplayerSnapshot" }
}
```

**Errors:**

| Status | Reason                                     |
| ------ | ------------------------------------------ |
| 409    | Room full, guest active game limit reached |

---

### POST /api/games/:gameId/access

Access a game. Takes a seat if one is available; spectates if the game is full.

**Response 200:**

```json
{
  "snapshot": { "...": "MultiplayerSnapshot" }
}
```

---

## Matchmaking

### POST /api/matchmaking

Enter the matchmaking queue.

**Response 200:**

```json
{
  "matchmaking": {
    "status": "searching",
    "queuedAt": "2025-03-01T12:00:00.000Z"
  }
}
```

Possible `matchmaking` states:

```json
{ "status": "idle" }
```

```json
{ "status": "searching", "queuedAt": "2025-03-01T12:00:00.000Z" }
```

```json
{ "status": "matched", "snapshot": { "...": "MultiplayerSnapshot" } }
```

---

### GET /api/matchmaking

Get the current matchmaking status.

**Response 200:**

```json
{
  "matchmaking": {
    "status": "idle"
  }
}
```

---

### DELETE /api/matchmaking

Leave the matchmaking queue.

**Response 204:** No body.

---

### POST /api/games/:gameId/test-finish

Force finish a game. Development only.

**Request:**

```json
{
  "winner": "white"
}
```

`winner` must be `"white"` or `"black"`.

**Response 200:**

```json
{
  "message": "Game finished."
}
```

**Errors:**

| Status | Reason                    |
| ------ | ------------------------- |
| 403    | Not allowed in production |

---

## Social

All social endpoints require account authentication. Guests receive `403`.

### GET /api/player/social/overview

Get the full social overview including friends, requests, and invitations.

**Response 200:**

```json
{
  "overview": {
    "friends": [{ "playerId": "def456", "displayName": "Bob", "kind": "account" }],
    "incomingFriendRequests": [
      { "playerId": "ghi789", "displayName": "Charlie", "kind": "account" }
    ],
    "outgoingFriendRequests": [],
    "incomingInvitations": [
      {
        "invitationId": "inv-001",
        "gameId": "ABC123",
        "sender": { "playerId": "def456", "displayName": "Bob" },
        "expiresAt": "2025-03-01T13:00:00.000Z"
      }
    ],
    "outgoingInvitations": []
  }
}
```

---

### GET /api/player/social/search?q=query

Search for players by display name or exact email.

**Query parameters:**

| Parameter | Required | Description                         |
| --------- | -------- | ----------------------------------- |
| `q`       | Yes      | Search string, minimum 2 characters |

**Response 200:**

```json
{
  "results": [
    {
      "player": {
        "playerId": "def456",
        "displayName": "Bob",
        "kind": "account"
      },
      "relationship": "friend"
    },
    {
      "player": {
        "playerId": "jkl012",
        "displayName": "Dana",
        "kind": "account"
      },
      "relationship": "none"
    }
  ]
}
```

Possible `relationship` values: `"none"`, `"friend"`, `"incoming-request"`, `"outgoing-request"`.

**Errors:**

| Status | Reason                                   |
| ------ | ---------------------------------------- |
| 400    | Query too short (less than 2 characters) |

---

### POST /api/player/social/friend-requests

Send a friend request.

**Request:**

```json
{
  "accountId": "def456"
}
```

**Response 200:**

```json
{
  "message": "Friend request sent."
}
```

**Errors:**

| Status | Reason                                          |
| ------ | ----------------------------------------------- |
| 400    | Missing accountId, cannot add yourself          |
| 404    | Player not found                                |
| 409    | Already friends, pending request already exists |

---

### POST /api/player/social/friend-requests/:accountId/accept

Accept an incoming friend request.

**Response 200:**

```json
{
  "message": "Friend request accepted."
}
```

---

### POST /api/player/social/friend-requests/:accountId/decline

Decline an incoming friend request.

**Response 200:**

```json
{
  "message": "Friend request declined."
}
```

---

### POST /api/player/social/friend-requests/:accountId/cancel

Cancel an outgoing friend request.

**Response 200:**

```json
{
  "message": "Friend request cancelled."
}
```

---

### POST /api/player/social/game-invitations

Send a game invitation to a friend.

**Request:**

```json
{
  "gameId": "ABC123",
  "recipientId": "def456",
  "expiresInMinutes": 60
}
```

`expiresInMinutes` must be between 5 and 10080 (7 days).

**Response 201** (new invitation):

```json
{
  "message": "Invitation sent."
}
```

**Response 200** (re-inviting same person to same game):

```json
{
  "message": "Invitation updated."
}
```

**Errors:**

| Status | Reason                                               |
| ------ | ---------------------------------------------------- |
| 400    | Missing required fields, invalid duration            |
| 403    | Not friends with recipient, not in the game          |
| 409    | Game already finished, recipient already in the game |

---

### POST /api/player/social/game-invitations/:invitationId/revoke

Revoke a sent invitation.

**Response 200:**

```json
{
  "message": "Invitation revoked."
}
```

**Errors:**

| Status | Reason                                  |
| ------ | --------------------------------------- |
| 404    | Invitation not found or already expired |

---

## WebSocket Protocol

### Game Connection

Connect to a game room via WebSocket:

```
ws://host/api/ws?gameId=ROOM_ID
```

The `tiao.session` cookie is sent automatically by the browser.

#### Client-to-Server Messages

**Place a piece:**

```json
{ "type": "place-piece", "position": { "x": 9, "y": 9 } }
```

**Jump a piece:**

```json
{ "type": "jump-piece", "from": { "x": 5, "y": 5 }, "to": { "x": 7, "y": 5 } }
```

**Confirm a multi-step jump sequence:**

```json
{ "type": "confirm-jump" }
```

**Undo the last pending jump step:**

```json
{ "type": "undo-pending-jump-step" }
```

**Request a rematch (after game ends):**

```json
{ "type": "request-rematch" }
```

**Decline a rematch request:**

```json
{ "type": "decline-rematch" }
```

#### Server-to-Client Messages

**Game snapshot** (sent on connect and after every state change):

```json
{
  "type": "snapshot",
  "snapshot": {
    "gameId": "ABC123",
    "roomType": "direct",
    "status": "active",
    "state": { "...": "full board state" },
    "players": [],
    "seats": { "white": null, "black": null },
    "rematch": null,
    "createdAt": "2025-03-01T12:00:00.000Z",
    "updatedAt": "2025-03-01T12:10:00.000Z"
  }
}
```

**Error:**

```json
{
  "type": "error",
  "code": "NOT_YOUR_TURN",
  "message": "It is not your turn."
}
```

#### Error Codes

| Code                   | Meaning                                     |
| ---------------------- | ------------------------------------------- |
| `NOT_IN_GAME`          | Player is not seated in this game           |
| `NOT_YOUR_TURN`        | It is not the player's turn                 |
| `WAITING_FOR_OPPONENT` | Game has not started yet (missing opponent) |
| `GAME_NOT_FINISHED`    | Cannot request rematch on an active game    |
| `NO_REMATCH_REQUEST`   | Declining when no rematch request exists    |
| `UNKNOWN_ACTION`       | Unrecognized message type                   |

Additional error codes from the game engine's `RuleFailureCode` may be returned for invalid moves.

---

### Lobby Connection

Real-time updates for account players. No client-to-server messages.

```
ws://host/api/ws/lobby
```

Account authentication required.

#### Server-to-Client Messages

**Game update** (sent when any of the player's games changes):

```json
{
  "type": "game-update",
  "summary": {
    "gameId": "ABC123",
    "status": "active",
    "currentTurn": "white",
    "yourSeat": "white",
    "score": { "white": 5, "black": 3 },
    "roomType": "direct",
    "createdAt": "2025-03-01T12:00:00.000Z",
    "updatedAt": "2025-03-01T12:10:00.000Z",
    "historyLength": 10,
    "winner": null,
    "players": [],
    "seats": { "white": null, "black": null }
  }
}
```

**Social update** (sent when friends, requests, or invitations change):

```json
{
  "type": "social-update",
  "overview": {
    "friends": [],
    "incomingFriendRequests": [],
    "outgoingFriendRequests": [],
    "incomingInvitations": [],
    "outgoingInvitations": []
  }
}
```

---

## Common Types

### MultiplayerSnapshot

```typescript
{
  gameId: string;             // 6-char room code, e.g. "ABC123"
  roomType: "direct" | "matchmaking";
  status: "waiting" | "active" | "finished";
  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601
  state: GameState;           // Full board state (includes history: TurnRecord[])
  players: PlayerSlot[];
  rematch: { requestedBy: ("white" | "black")[] } | null;
  seats: {
    white: PlayerSlot | null;
    black: PlayerSlot | null;
  };
}
```

### MultiplayerGameSummary

```typescript
{
  gameId: string;
  roomType: "direct" | "matchmaking";
  status: "waiting" | "active" | "finished";
  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601
  currentTurn: "white" | "black";
  historyLength: number;
  winner: "white" | "black" | null;
  yourSeat: "white" | "black" | null;
  score: { white: number; black: number };
  players: PlayerSlot[];
  seats: {
    white: PlayerSlot | null;
    black: PlayerSlot | null;
  };
}
```

### PlayerSlot

```typescript
{
  player: PlayerIdentity;
  online: boolean;
}
```

### PlayerIdentity

```typescript
{
  playerId: string;
  displayName: string;
  kind: "guest" | "account";
  email?: string;
  profilePicture?: string;
}
```

### MatchmakingState

```typescript
{ status: "idle" }
| { status: "searching"; queuedAt: string }
| { status: "matched"; snapshot: MultiplayerSnapshot }
```

### TurnRecord (Move History)

The `GameState.history` array contains every move made in the game. Each entry is one of:

```typescript
// Piece placement
{
  type: "put";
  color: "white" | "black";
  position: {
    x: number;
    y: number;
  }
}

// Jump sequence (one or more captures)
{
  type: "jump";
  color: "white" | "black";
  jumps: Array<{
    from: { x: number; y: number };
    over: { x: number; y: number }; // captured piece position
    to: { x: number; y: number };
    color: "white" | "black";
  }>;
}
```

Move history is persisted for all multiplayer games and returned in `MultiplayerSnapshot.state.history`. Use the `replayToMove(history, moveIndex)` utility from the shared package to reconstruct the board state at any point in the game.
