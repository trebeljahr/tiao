import express, { Request, Response } from "express";
import mongoose from "mongoose";
import {
  GameInvitationSummary,
  SocialOverview,
  SocialPlayerSummary,
  SocialSearchRelationship,
  SocialSearchResult,
} from "../../shared/src";
import { classifyMongoError } from "../error-handling";
import { GameServiceError, gameService } from "../game/gameService";
import { getPlayerFromRequest } from "../game/playerTokens";
import GameAccount, { IGameAccount } from "../models/GameAccount";
import GameInvitation from "../models/GameInvitation";
import { userSearchRateLimiter } from "../middleware/rateLimiter";

const router = express.Router();

function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

function containsAccountId(
  accountIds: ReadonlyArray<{ toString(): string }>,
  targetId: string
): boolean {
  return accountIds.some((accountId) => accountId.toString() === targetId);
}

function removeAccountId<T extends { toString(): string }>(
  accountIds: ReadonlyArray<T>,
  targetId: string
) {
  return accountIds.filter((accountId) => accountId.toString() !== targetId);
}

function toSocialPlayerSummary(
  account: {
    id?: string;
    _id?: unknown;
    displayName: string;
    profilePicture?: string;
    email?: string;
  },
  options: {
    includeEmail?: boolean;
  } = {}
): SocialPlayerSummary {
  return {
    playerId: account.id ?? (account._id ? String(account._id) : ""),
    displayName: account.displayName,
    profilePicture: account.profilePicture,
    ...(options.includeEmail ? { email: account.email } : {}),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expireStaleInvitations() {
  await GameInvitation.updateMany(
    {
      status: "pending",
      expiresAt: {
        $lte: new Date(),
      },
    },
    {
      $set: {
        status: "expired",
      },
    }
  );
}

async function requireAccount(req: Request, res: Response) {
  if (!isDatabaseReady()) {
    res.status(503).json({
      message:
        "Account social features are unavailable right now. You can still play as a guest.",
    });
    return null;
  }

  const player = await getPlayerFromRequest(req);
  if (!player) {
    res.status(401).json({
      message: "Not authenticated.",
    });
    return null;
  }

  if (player.kind !== "account") {
    res.status(403).json({
      message: "Sign in with an account to use friends and invitations.",
    });
    return null;
  }

  const account = await GameAccount.findById(player.playerId);
  if (!account) {
    res.status(404).json({
      message: "That account could not be found.",
    });
    return null;
  }

  return account;
}

function getSearchRelationship(
  account: IGameAccount,
  targetId: string
): SocialSearchRelationship {
  if (containsAccountId(account.friends, targetId)) {
    return "friend";
  }

  if (containsAccountId(account.receivedFriendRequests, targetId)) {
    return "incoming-request";
  }

  if (containsAccountId(account.sentFriendRequests, targetId)) {
    return "outgoing-request";
  }

  return "none";
}

async function loadAccountsById(accountIds: ReadonlyArray<{ toString(): string }>) {
  const normalizedIds = accountIds.map((accountId) => accountId.toString());
  if (normalizedIds.length === 0) {
    return [];
  }

  const accounts = await GameAccount.find({
    _id: {
      $in: normalizedIds,
    },
  })
    .sort({ displayName: 1 })
    .lean<IGameAccount[]>()
    .exec();

  return accounts.map((account) => toSocialPlayerSummary(account));
}

async function loadFriendsWithOnlineStatus(
  accountIds: ReadonlyArray<{ toString(): string }>
): Promise<SocialPlayerSummary[]> {
  const friends = await loadAccountsById(accountIds);
  return friends.map((friend) => ({
    ...friend,
    online: gameService.isPlayerConnectedToLobby(friend.playerId),
  }));
}

async function loadInvitationSummaries(
  filter: Record<string, unknown>
): Promise<GameInvitationSummary[]> {
  const invitations = await GameInvitation.find(filter)
    .populate("senderId", "displayName profilePicture email")
    .populate("recipientId", "displayName profilePicture email")
    .sort({ createdAt: -1 })
    .limit(50)
    .exec();

  return invitations.map((invitation) => {
    const sender = invitation.senderId as unknown as IGameAccount;
    const recipient = invitation.recipientId as unknown as IGameAccount;

    return {
      id: invitation.id,
      gameId: invitation.gameId,
      roomType: invitation.roomType,
      createdAt: invitation.createdAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      sender: toSocialPlayerSummary(sender),
      recipient: toSocialPlayerSummary(recipient),
    };
  });
}

function handleRouteError(
  error: unknown,
  req: Request,
  res: Response,
  fallbackMessage: string
) {
  if (error instanceof GameServiceError) {
    return res.status(error.status).json({
      code: error.code,
      message: error.message,
    });
  }

  const mongoError = classifyMongoError(error);
  if (mongoError) {
    console.warn(
      `[${req.method} ${req.path}] MongoDB ${mongoError.code}:`,
      error
    );
    return res.status(mongoError.status).json({
      code: mongoError.code,
      message: mongoError.message,
    });
  }

  console.error(`[${req.method} ${req.path}] Unhandled error:`, error);
  return res.status(500).json({
    code: "INTERNAL_ERROR",
    message: fallbackMessage,
  });
}

async function notifyLobbyUpdate(playerId: string) {
  const account = await GameAccount.findById(playerId);
  if (!account) return;

  await expireStaleInvitations();

  const [friends, incomingFriendRequests, outgoingFriendRequests] =
    await Promise.all([
      loadFriendsWithOnlineStatus(account.friends),
      loadAccountsById(account.receivedFriendRequests),
      loadAccountsById(account.sentFriendRequests),
    ]);

  const [incomingInvitations, outgoingInvitations] = await Promise.all([
    loadInvitationSummaries({
      recipientId: account._id,
      status: "pending",
      expiresAt: {
        $gt: new Date(),
      },
    }),
    loadInvitationSummaries({
      senderId: account._id,
      status: "pending",
      expiresAt: {
        $gt: new Date(),
      },
    }),
  ]);

  const overview: SocialOverview = {
    friends,
    incomingFriendRequests,
    outgoingFriendRequests,
    incomingInvitations,
    outgoingInvitations,
  };

  gameService.broadcastLobby(playerId, {
    type: "social-update",
    overview,
  });
}

/**
 * @openapi
 * /api/player/social/overview:
 *   get:
 *     summary: Get social overview (friends, requests, invitations)
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       200:
 *         description: Social overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 overview:
 *                   $ref: '#/components/schemas/SocialOverview'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required
 *       404:
 *         description: Account not found
 *       503:
 *         description: Social features unavailable
 */
router.get("/player/social/overview", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    await expireStaleInvitations();

    const [friends, incomingFriendRequests, outgoingFriendRequests] =
      await Promise.all([
        loadFriendsWithOnlineStatus(account.friends),
        loadAccountsById(account.receivedFriendRequests),
        loadAccountsById(account.sentFriendRequests),
      ]);

    const [incomingInvitations, outgoingInvitations] = await Promise.all([
      loadInvitationSummaries({
        recipientId: account._id,
        status: "pending",
        expiresAt: {
          $gt: new Date(),
        },
      }),
      loadInvitationSummaries({
        senderId: account._id,
        status: "pending",
        expiresAt: {
          $gt: new Date(),
        },
      }),
    ]);

    const overview: SocialOverview = {
      friends,
      incomingFriendRequests,
      outgoingFriendRequests,
      incomingInvitations,
      outgoingInvitations,
    };

    return res.status(200).json({ overview });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to load social overview right now.");
  }
});

/**
 * @openapi
 * /api/player/social/search:
 *   get:
 *     summary: Search for players by name or email
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (display name or exact email)
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player:
 *                         type: object
 *                         properties:
 *                           playerId:
 *                             type: string
 *                           displayName:
 *                             type: string
 *                           profilePicture:
 *                             type: string
 *                           email:
 *                             type: string
 *                       relationship:
 *                         type: string
 *                         enum: [friend, incoming-request, outgoing-request, none]
 *       400:
 *         description: Query too short (minimum 2 characters)
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required
 *       404:
 *         description: Account not found
 *       503:
 *         description: Social features unavailable
 */
router.get("/player/social/search", userSearchRateLimiter, async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    if (typeof req.query.q !== "string") {
      return res.status(400).json({
        message: "Provide a single search query.",
      });
    }

    const query = req.query.q.slice(0, 100).trim();
    if (query.length < 2) {
      return res.status(400).json({
        message: "Search with at least 2 characters.",
      });
    }

    const normalizedQuery = query.toLowerCase();
    const matcher = query.includes("@")
      ? {
          email: normalizedQuery,
        }
      : {
          displayName: {
            $regex: escapeRegExp(query),
            $options: "i",
          },
        };

    const accounts = await GameAccount.find({
      _id: {
        $ne: account._id,
      },
      ...matcher,
    })
      .sort({ displayName: 1 })
      .limit(8)
      .lean<IGameAccount[]>()
      .exec();

    const results: SocialSearchResult[] = accounts.map((result) => ({
      player: toSocialPlayerSummary(result, { includeEmail: true }),
      relationship: getSearchRelationship(account, String(result._id)),
    }));

    return res.status(200).json({ results });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to search for players right now.");
  }
});

/**
 * @openapi
 * /api/player/social/friend-requests:
 *   post:
 *     summary: Send a friend request
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accountId
 *             properties:
 *               accountId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Friend request sent
 *       400:
 *         description: Missing accountId or cannot add yourself
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required
 *       404:
 *         description: Target player or account not found
 *       409:
 *         description: Already friends or pending request exists
 *       503:
 *         description: Social features unavailable
 */
router.post("/player/social/friend-requests", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    const { accountId } = req.body as {
      accountId?: string;
    };

    if (!accountId || !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({
        message: "Choose a player to add.",
      });
    }

    if (account.id === accountId) {
      return res.status(400).json({
        message: "You cannot add yourself as a friend.",
      });
    }

    const targetAccount = await GameAccount.findById(accountId);
    if (!targetAccount) {
      return res.status(404).json({
        message: "That player could not be found.",
      });
    }

    if (
      containsAccountId(account.friends, targetAccount.id) ||
      containsAccountId(targetAccount.friends, account.id)
    ) {
      return res.status(409).json({
        message: "You are already friends.",
      });
    }

    if (
      containsAccountId(account.sentFriendRequests, targetAccount.id) ||
      containsAccountId(account.receivedFriendRequests, targetAccount.id)
    ) {
      return res.status(409).json({
        message: "There is already a pending request between you.",
      });
    }

    account.sentFriendRequests.push(targetAccount._id);
    targetAccount.receivedFriendRequests.push(account._id);

    await Promise.all([account.save(), targetAccount.save()]);

    void notifyLobbyUpdate(account.id);
    void notifyLobbyUpdate(targetAccount.id);

    return res.status(200).json({
      message: "Friend request sent.",
    });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to send friend request right now.");
  }
});

/**
 * @openapi
 * /api/player/social/friend-requests/{accountId}/accept:
 *   post:
 *     summary: Accept a friend request
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         description: Account ID of the requester
 *     responses:
 *       200:
 *         description: Friend request accepted
 *       400:
 *         description: No pending friend request from that player
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required
 *       404:
 *         description: Player or account not found
 *       503:
 *         description: Social features unavailable
 */
router.post(
  "/player/social/friend-requests/:accountId/accept",
  async (req: Request, res: Response) => {
    try {
      const account = await requireAccount(req, res);
      if (!account) {
        return;
      }

      const requesterId = req.params.accountId;
      if (!mongoose.Types.ObjectId.isValid(requesterId)) {
        return res.status(400).json({ message: "Invalid account ID." });
      }

      const requester = await GameAccount.findById(requesterId);

      if (!requester) {
        return res.status(404).json({
          message: "That player could not be found.",
        });
      }

      if (!containsAccountId(account.receivedFriendRequests, requester.id)) {
        return res.status(400).json({
          message: "No pending friend request from that player.",
        });
      }

      account.receivedFriendRequests = removeAccountId(
        account.receivedFriendRequests,
        requester.id
      ) as mongoose.Types.ObjectId[];
      requester.sentFriendRequests = removeAccountId(
        requester.sentFriendRequests,
        account.id
      ) as mongoose.Types.ObjectId[];

      if (!containsAccountId(account.friends, requester.id)) {
        account.friends.push(requester._id);
      }

      if (!containsAccountId(requester.friends, account.id)) {
        requester.friends.push(account._id);
      }

      await Promise.all([account.save(), requester.save()]);

      void notifyLobbyUpdate(account.id);
      void notifyLobbyUpdate(requester.id);

      return res.status(200).json({
        message: "Friend request accepted.",
      });
    } catch (error) {
      return handleRouteError(error, req, res, "Unable to accept friend request right now.");
    }
  }
);

/**
 * @openapi
 * /api/player/social/friend-requests/{accountId}/decline:
 *   post:
 *     summary: Decline a friend request
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         description: Account ID of the requester
 *     responses:
 *       200:
 *         description: Friend request declined
 *       400:
 *         description: No pending friend request from that player
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required
 *       404:
 *         description: Player or account not found
 *       503:
 *         description: Social features unavailable
 */
router.post(
  "/player/social/friend-requests/:accountId/decline",
  async (req: Request, res: Response) => {
    try {
      const account = await requireAccount(req, res);
      if (!account) {
        return;
      }

      const requesterId = req.params.accountId;
      if (!mongoose.Types.ObjectId.isValid(requesterId)) {
        return res.status(400).json({ message: "Invalid account ID." });
      }

      const requester = await GameAccount.findById(requesterId);

      if (!requester) {
        return res.status(404).json({
          message: "That player could not be found.",
        });
      }

      if (!containsAccountId(account.receivedFriendRequests, requester.id)) {
        return res.status(400).json({
          message: "No pending friend request from that player.",
        });
      }

      account.receivedFriendRequests = removeAccountId(
        account.receivedFriendRequests,
        requester.id
      ) as mongoose.Types.ObjectId[];
      requester.sentFriendRequests = removeAccountId(
        requester.sentFriendRequests,
        account.id
      ) as mongoose.Types.ObjectId[];

      await Promise.all([account.save(), requester.save()]);

      void notifyLobbyUpdate(account.id);
      void notifyLobbyUpdate(requester.id);

      return res.status(200).json({
        message: "Friend request declined.",
      });
    } catch (error) {
      return handleRouteError(error, req, res, "Unable to decline friend request right now.");
    }
  }
);

/**
 * @openapi
 * /api/player/social/friend-requests/{accountId}/cancel:
 *   post:
 *     summary: Cancel an outgoing friend request
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         description: Account ID of the target player
 *     responses:
 *       200:
 *         description: Friend request cancelled
 *       400:
 *         description: No outgoing request to that player
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required
 *       404:
 *         description: Player or account not found
 *       503:
 *         description: Social features unavailable
 */
router.post(
  "/player/social/friend-requests/:accountId/cancel",
  async (req: Request, res: Response) => {
    try {
      const account = await requireAccount(req, res);
      if (!account) {
        return;
      }

      const targetId = req.params.accountId;
      if (!mongoose.Types.ObjectId.isValid(targetId)) {
        return res.status(400).json({ message: "Invalid account ID." });
      }

      const targetAccount = await GameAccount.findById(targetId);

      if (!targetAccount) {
        return res.status(404).json({
          message: "That player could not be found.",
        });
      }

      if (!containsAccountId(account.sentFriendRequests, targetAccount.id)) {
        return res.status(400).json({
          message: "No outgoing request to that player.",
        });
      }

      account.sentFriendRequests = removeAccountId(
        account.sentFriendRequests,
        targetAccount.id
      ) as mongoose.Types.ObjectId[];
      targetAccount.receivedFriendRequests = removeAccountId(
        targetAccount.receivedFriendRequests,
        account.id
      ) as mongoose.Types.ObjectId[];

      await Promise.all([account.save(), targetAccount.save()]);

      void notifyLobbyUpdate(account.id);
      void notifyLobbyUpdate(targetAccount.id);

      return res.status(200).json({
        message: "Friend request cancelled.",
      });
    } catch (error) {
      return handleRouteError(error, req, res, "Unable to cancel friend request right now.");
    }
  }
);

/**
 * @openapi
 * /api/player/social/game-invitations:
 *   post:
 *     summary: Send a game invitation to a friend
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - gameId
 *               - recipientId
 *               - expiresInMinutes
 *             properties:
 *               gameId:
 *                 type: string
 *               recipientId:
 *                 type: string
 *               expiresInMinutes:
 *                 type: number
 *                 minimum: 5
 *                 maximum: 10080
 *     responses:
 *       200:
 *         description: Existing invitation updated
 *       201:
 *         description: Invitation sent
 *       400:
 *         description: Missing fields or invalid expiration duration
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required, not in the room, or recipient is not a friend
 *       404:
 *         description: Recipient or account not found
 *       409:
 *         description: Game is finished or recipient already in the room
 *       503:
 *         description: Social features unavailable
 */
router.post("/player/social/game-invitations", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    const {
      gameId,
      recipientId,
      expiresInMinutes,
    } = req.body as {
      gameId?: string;
      recipientId?: string;
      expiresInMinutes?: number;
    };

    if (!gameId || !recipientId) {
      return res.status(400).json({
        message: "Choose a game and friend to invite.",
      });
    }

    if (!expiresInMinutes || expiresInMinutes < 5 || expiresInMinutes > 10080) {
      return res.status(400).json({
        message: "Pick an invitation duration between 5 minutes and 7 days.",
      });
    }

    const recipient = await GameAccount.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({
        message: "That friend could not be found.",
      });
    }

    if (!containsAccountId(account.friends, recipient.id)) {
      return res.status(403).json({
        message: "You can only invite people from your friends list.",
      });
    }

    const snapshot = await gameService.getSnapshot(gameId);
    const isPlayerInRoom = snapshot.players.some(
      (slot) => slot.player.playerId === account.id
    );

    if (!isPlayerInRoom) {
      return res.status(403).json({
        message: "Join the room before inviting a friend.",
      });
    }

    if (snapshot.status === "finished") {
      return res.status(409).json({
        message: "Finished games cannot receive new invitations.",
      });
    }

    if (
      snapshot.players.some((slot) => slot.player.playerId === recipient.id)
    ) {
      return res.status(409).json({
        message: "That friend is already in the room.",
      });
    }

    await expireStaleInvitations();

    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const existingInvitation = await GameInvitation.findOne({
      gameId: snapshot.gameId,
      senderId: account._id,
      recipientId: recipient._id,
      status: "pending",
      expiresAt: {
        $gt: new Date(),
      },
    });

    if (existingInvitation) {
      existingInvitation.expiresAt = expiresAt;
      existingInvitation.roomType = snapshot.roomType;
      await existingInvitation.save();

      void notifyLobbyUpdate(account.id);
      void notifyLobbyUpdate(recipient.id);

      return res.status(200).json({
        message: "Invitation updated.",
      });
    }

    await GameInvitation.create({
      gameId: snapshot.gameId,
      roomType: snapshot.roomType,
      senderId: account._id,
      recipientId: recipient._id,
      expiresAt,
      status: "pending",
    });

    void notifyLobbyUpdate(account.id);
    void notifyLobbyUpdate(recipient.id);

    return res.status(201).json({
      message: "Invitation sent.",
    });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to create that invitation right now.");
  }
});

/**
 * @openapi
 * /api/player/social/game-invitations/{invitationId}/revoke:
 *   post:
 *     summary: Revoke a pending game invitation
 *     tags:
 *       - Social
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the invitation to revoke
 *     responses:
 *       200:
 *         description: Invitation revoked
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Account required
 *       404:
 *         description: Invitation not found or no longer active
 *       503:
 *         description: Social features unavailable
 */
router.post(
  "/player/social/game-invitations/:invitationId/revoke",
  async (req: Request, res: Response) => {
    try {
      const account = await requireAccount(req, res);
      if (!account) {
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(req.params.invitationId)) {
        return res.status(400).json({ message: "Invalid invitation ID." });
      }

      const invitation = await GameInvitation.findOne({
        _id: req.params.invitationId,
        senderId: account._id,
        status: "pending",
        expiresAt: {
          $gt: new Date(),
        },
      });

      if (!invitation) {
        return res.status(404).json({
          message: "That invitation is no longer active.",
        });
      }

      invitation.status = "revoked";
      await invitation.save();

      void notifyLobbyUpdate(account.id);
      void notifyLobbyUpdate(invitation.recipientId.toString());

      return res.status(200).json({
        message: "Invitation revoked.",
      });
    } catch (error) {
      return handleRouteError(error, req, res, "Unable to revoke invitation right now.");
    }
  }
);

router.post(
  "/player/social/game-invitations/:invitationId/decline",
  async (req: Request, res: Response) => {
    try {
      const account = await requireAccount(req, res);
      if (!account) {
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(req.params.invitationId)) {
        return res.status(400).json({ message: "Invalid invitation ID." });
      }

      const invitation = await GameInvitation.findOne({
        _id: req.params.invitationId,
        recipientId: account._id,
        status: "pending",
        expiresAt: {
          $gt: new Date(),
        },
      });

      if (!invitation) {
        return res.status(404).json({
          message: "That invitation is no longer active.",
        });
      }

      invitation.status = "declined";
      await invitation.save();

      void notifyLobbyUpdate(account.id);
      void notifyLobbyUpdate(invitation.senderId.toString());

      return res.status(200).json({
        message: "Invitation declined.",
      });
    } catch (error) {
      return handleRouteError(error, req, res, "Unable to decline invitation right now.");
    }
  }
);

router.post(
  "/player/social/friends/:accountId/remove",
  async (req: Request, res: Response) => {
    try {
      const account = await requireAccount(req, res);
      if (!account) {
        return;
      }

      const targetId = req.params.accountId;
      if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
        return res.status(400).json({ message: "Invalid account ID." });
      }

      if (!containsAccountId(account.friends, targetId)) {
        return res.status(400).json({
          message: "That player is not in your friends list.",
        });
      }

      const targetAccount = await GameAccount.findById(targetId);
      if (!targetAccount) {
        return res.status(404).json({ message: "Player not found." });
      }

      account.friends = removeAccountId(
        account.friends,
        targetId
      ) as mongoose.Types.ObjectId[];

      targetAccount.friends = removeAccountId(
        targetAccount.friends,
        account.id
      ) as mongoose.Types.ObjectId[];

      await Promise.all([account.save(), targetAccount.save()]);

      void notifyLobbyUpdate(account.id);
      void notifyLobbyUpdate(targetAccount.id);

      return res.status(200).json({
        message: "Friend removed.",
      });
    } catch (error) {
      return handleRouteError(error, req, res, "Unable to remove friend right now.");
    }
  }
);

export default router;
