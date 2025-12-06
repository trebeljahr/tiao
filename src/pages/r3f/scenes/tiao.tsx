import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useCallback, useState } from "react";

export default function Page() {
  return <TiaoBoard />;
}

const scoreNecessaryToWin = 10;

const xyDirections = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

type TileState = "black" | "white" | null;

type Jump = {
  from: { x: number; y: number };
  over: { x: number; y: number };
  to: { x: number; y: number };
  color: "black" | "white";
};

type Put = {
  position: { x: number; y: number };
  color: "black" | "white";
};

type Move = Jump | Put | Jump[];

type BoardState = {
  positions: TileState[][];
  highlightedCluster: { x: number; y: number }[] | null;
  currentTurn: "black" | "white";
  ongoingJump: Jump[];
  selectedPiece: { x: number; y: number } | null;
  selectedPiecePaths: { x: number; y: number }[];
  markedForRemoval: { x: number; y: number }[];
  score: {
    black: number;
    white: number;
  };
  history: Move[];
};

const checkForClusterRule = (state: BoardState, x: number, y: number) => {
  for (const dir of xyDirections) {
    const adjX = x + dir.dx;
    const adjY = y + dir.dy;
    if (adjX >= 0 && adjX < boardSize && adjY >= 0 && adjY < boardSize) {
      if (
        state.positions[adjY][adjX] === null ||
        state.positions[adjY][adjX] !== state.currentTurn
      ) {
        continue;
      }

      const adjacentCluster = findConnectedCluster(
        adjX,
        adjY,
        state,
        state.currentTurn
      );

      if (adjacentCluster.length >= 10) {
        console.log("cluster too big, cannot place piece");
        return true;
      }
    }

    return false;
  }
};

const boardSize = 19;

const initialBoardState: BoardState = {
  ongoingJump: [],
  positions: Array(boardSize).fill(Array(boardSize).fill(null)),
  highlightedCluster: null,
  currentTurn: "white",
  selectedPiece: null,
  selectedPiecePaths: [],
  markedForRemoval: [],
  score: { black: 0, white: 0 },
  history: [],
};

const positionIsOnBorder = (x: number, y: number) => {
  return (
    positionOnTopEdge(x, y) ||
    positionOnBottomEdge(x, y) ||
    positionOnLeftEdge(x, y) ||
    positionOnRightEdge(x, y)
  );
};

const allDirections = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
];

const allJumpDirections = allDirections.map(({ dx, dy }) => ({
  dx: dx * 2,
  dy: dy * 2,
}));

const checkForBorderRule = (boardState: BoardState, x: number, y: number) => {
  if (!positionIsOnBorder(x, y)) {
    console.log("position not on border, therefore *can* place piece!");
    return false;
  }

  if (posCouldBeJumpedByEnemy(x, y, boardState)) {
    console.log("position can be jumped to, therefore *can* place piece!");
    return false;
  }

  console.log(
    "position on border and cannot be jumped to, therefore *cannot* place piece!"
  );
  return true;
};

const posIsInBounds = (x: number, y: number) => {
  return x >= 0 && x < boardSize && y >= 0 && y < boardSize;
};

const gameIsOver = (boardState: BoardState) => {
  return (
    boardState.score.black >= scoreNecessaryToWin ||
    boardState.score.white >= scoreNecessaryToWin
  );
};

const posCouldBeJumpedByEnemy = (
  x: number,
  y: number,
  boardState: BoardState
) => {
  for (const { dx, dy } of allJumpDirections) {
    const jumpX = x + dx;
    const jumpY = y + dy;

    const midX = x + dx / 2;
    const midY = y + dy / 2;

    if (!posIsInBounds(jumpX, jumpY)) continue;
    if (!posIsInBounds(midX, midY)) continue;

    const midPiece = boardState.positions[midY][midX];
    const jumpingPiece = boardState.positions[jumpY][jumpX];

    const midPieceAlreadyTaken = boardState.markedForRemoval.find(
      (pos) => pos.x === midX && pos.y === midY
    );

    if (midPiece !== boardState.currentTurn || midPieceAlreadyTaken) {
      continue;
    }

    const jumpingPosIsEnemy =
      jumpingPiece !== null && jumpingPiece !== boardState.currentTurn;

    if (jumpingPosIsEnemy) {
      return true;
    }

    if (jumpingPiece === null) {
      const markedForRemoval = [
        ...boardState.markedForRemoval,
        { x: midX, y: midY },
      ];

      const resultOfRecursion = posCouldBeJumpedByEnemy(jumpX, jumpY, {
        ...boardState,
        markedForRemoval,
      });

      if (resultOfRecursion) {
        return true;
      }
    }
  }

  return false;
};

const TiaoBoard = () => {
  const [boardState, setBoardState] = useState(initialBoardState);

  const hoverPosition = (x: number, y: number) => () => {
    if (gameIsOver(boardState)) {
      return;
    }

    const { jumpIsInProgress, lastJumpedPositionIsThisTile } =
      getCurrentJumpInfo(boardState);
    if (
      boardState.positions[y][x] === null ||
      boardState.currentTurn !== boardState.positions[y][x] ||
      (jumpIsInProgress && !lastJumpedPositionIsThisTile)
    ) {
      return;
    }

    const connectedCluster = findConnectedCluster(x, y, boardState);

    setBoardState((prevState) => ({
      ...prevState,
      highlightedCluster: connectedCluster,
      selectedPiece: { x, y },
      selectedPiecePaths: findJumpingPaths(
        x,
        y,
        boardState,
        boardState.positions[y][x]!
      ),
    }));
  };

  const clickPosition = (x: number, y: number) => () => {
    if (boardState.positions[y][x] !== null) {
      return;
    }

    if (boardState.ongoingJump.length > 0) {
      return;
    }

    if (checkForClusterRule(boardState, x, y)) {
      return;
    }

    if (checkForBorderRule(boardState, x, y)) {
      return;
    }

    if (gameIsOver(boardState)) {
      return;
    }

    setBoardState((state) => {
      const newPositions = state.positions.map((row) => row.slice());
      newPositions[y][x] = state.currentTurn;

      const moveRecord: Put = {
        position: { x, y },
        color: state.currentTurn,
      };

      return {
        ...state,
        positions: newPositions,
        highlightedCluster: null,
        currentTurn: state.currentTurn === "white" ? "black" : "white",
        selectedPiece: null,
        selectedPiecePaths: [],
        ongoingJump: [],
        markedForRemoval: [],
        history: [...state.history, moveRecord],
      };
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const confirmJump = () => {
    if (boardState.ongoingJump.length === 0) {
      return;
    }

    if (gameIsOver(boardState)) {
      return;
    }

    setBoardState((state) => {
      const newScore = {
        black:
          state.score.black +
          state.markedForRemoval.filter(
            (pos) => state.positions[pos.y][pos.x] === "white"
          ).length,
        white:
          state.score.white +
          state.markedForRemoval.filter(
            (pos) => state.positions[pos.y][pos.x] === "black"
          ).length,
      };

      for (const pos of state.markedForRemoval) {
        state.positions[pos.y][pos.x] = null;
      }

      return {
        ...state,
        positions: [...state.positions],
        score: newScore,
        history: [...state.history, state.ongoingJump],
        markedForRemoval: [],
        currentTurn: state.currentTurn === "white" ? "black" : "white",
        ongoingJump: [],
        selectedPiece: null,
        selectedPiecePaths: [],
      };
    });
  };

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (gameIsOver(boardState)) {
        return;
      }

      setBoardState((state) => {
        if (!over) return state;

        const movingStone = active.data.current as {
          position: {
            x: number;
            y: number;
          };
          color: TileState;
        };
        const pieceColor: TileState = active.data.current?.color;
        if (pieceColor === null) {
          return state;
        }

        const { x, y } = over.data.current?.position as {
          x: number;
          y: number;
        };

        const dropOffPosition = state.positions[y][x];
        if (dropOffPosition !== null) {
          return state;
        }

        const possiblePathMatches = boardState.selectedPiecePaths?.filter(
          ({ x: x2, y: y2 }) => x === x2 && y === y2
        );

        const droppedOnPossiblePath = possiblePathMatches?.length === 1;

        if (!droppedOnPossiblePath) {
          return state;
        }

        state.positions[movingStone.position.y][movingStone.position.x] = null;
        state.positions[y][x] = pieceColor;

        const movementDirection = {
          dx: x - movingStone.position.x,
          dy: y - movingStone.position.y,
        };

        const middleX = movingStone.position.x + movementDirection.dx / 2;
        const middleY = movingStone.position.y + movementDirection.dy / 2;

        state.markedForRemoval = [
          ...state.markedForRemoval,
          { x: middleX, y: middleY },
        ];

        const jump: Jump = {
          from: { x: movingStone.position.x, y: movingStone.position.y },
          to: { x, y },
          over: { x: middleX, y: middleY },
          color: pieceColor,
        };

        return {
          ...state,
          selectedPiece: { x, y },
          selectedPiecePaths: findJumpingPaths(x, y, state, state.currentTurn),
          ongoingJump: [...state.ongoingJump, jump],
        };
      });
    },
    [boardState]
  );

  const undoLastJump = () => {
    setBoardState((state) => {
      if (state.ongoingJump.length === 0) {
        return state;
      }

      const lastJump = state.ongoingJump[state.ongoingJump.length - 1];

      state.positions[lastJump.from.y][lastJump.from.x] = lastJump.color;
      state.positions[lastJump.to.y][lastJump.to.x] = null;

      state.markedForRemoval = state.markedForRemoval.filter(
        (pos) => !(pos.x === lastJump.over.x && pos.y === lastJump.over.y)
      );

      return {
        ...state,
        selectedPiece: { x: lastJump.from.x, y: lastJump.from.y },
        selectedPiecePaths: findJumpingPaths(
          lastJump.from.x,
          lastJump.from.y,
          state,
          state.currentTurn
        ),
        ongoingJump: state.ongoingJump.slice(0, -1),
      };
    });
  };

  const resetGame = () => {
    setBoardState(initialBoardState);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex w-screen min-h-screen flex-col sm:flex-row sm:items-center bg-orange-300">
        <div
          className="h-[90vmin] w-[90vmin]"
          style={{
            gridTemplateRows: `repeat(${boardSize}, 1fr)`,
            gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
          }}
        >
          {boardState.positions.map((row, rowIndex) => (
            <div key={rowIndex} className="flex">
              {row.map((color, colIndex) => (
                <GameBoardSlot
                  colIndex={colIndex}
                  rowIndex={rowIndex}
                  boardState={boardState}
                  hoverPosition={hoverPosition}
                  clickPosition={clickPosition}
                  color={color}
                  key={colIndex}
                />
              ))}
            </div>
          ))}
        </div>

        <div
          className="text-gray-950 not-prose sm:h-[90vmin]"
          style={{
            paddingTop: `calc(90vmin / ${boardSize} / 2)`,
            paddingLeft: `calc(90vmin / ${boardSize} / 2)`,
          }}
        >
          <h1 className="text-black font-bold text-5xl">条 Tiao</h1>

          <h2 className="text-gray-950 text-3xl">Score</h2>
          <p>Black: {boardState.score.black}</p>
          <p>White: {boardState.score.white}</p>
          <p>
            Current Turn: {boardState.currentTurn}{" "}
            <div
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: boardState.currentTurn }}
            />
          </p>

          <p>
            {boardState.score.black >= scoreNecessaryToWin
              ? "Black wins!"
              : boardState.score.white >= scoreNecessaryToWin
              ? "White wins!"
              : ""}
          </p>

          {gameIsOver(boardState) && (
            <button
              className="p-2 border-zinc-950 border border-solid"
              onClick={resetGame}
            >
              Reset Game
            </button>
          )}

          <p>{boardState.history.length} moves made.</p>

          {boardState.ongoingJump.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                className="p-2 border-zinc-950 border border-solid"
                onClick={confirmJump}
              >
                Confirm Jump?
              </button>
              <button
                className="p-2 border-zinc-950 border border-solid"
                onClick={undoLastJump}
              >
                Undo last Jump?
              </button>
            </div>
          )}
        </div>
      </div>
    </DndContext>
  );
};

const findJumpingPaths = (
  x: number,
  y: number,
  boardState: BoardState,
  color: "black" | "white"
) => {
  const paths = [] as { x: number; y: number }[];
  for (const { dx, dy } of allJumpDirections) {
    const midX = x + dx / 2;
    const midY = y + dy / 2;

    if (midX < 0 || midX >= boardSize || midY < 0 || midY >= boardSize) {
      continue;
    }

    const midPiece = boardState.positions[midY][midX];
    const midPieceAlreadyTaken = boardState.markedForRemoval.find(
      (pos) => pos.x === midX && pos.y === midY
    );
    if (midPiece === null || midPiece === color || midPieceAlreadyTaken) {
      continue;
    }

    const newX = x + dx;
    const newY = y + dy;
    if (
      newX >= 0 &&
      newX < boardSize &&
      newY >= 0 &&
      newY < boardSize &&
      boardState.positions[newY][newX] === null
    ) {
      paths.push({ x: newX, y: newY });
    }
  }

  return paths;
};

const GameBoardSlot = ({
  colIndex,
  rowIndex,
  boardState,
  hoverPosition,
  clickPosition,
  color,
}: {
  colIndex: number;
  rowIndex: number;
  boardState: BoardState;
  hoverPosition: (colIndex: number, rowIndex: number) => () => void;
  clickPosition: (colIndex: number, rowIndex: number) => () => void;
  color: TileState;
}) => {
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `slot-${rowIndex}-${colIndex}`,
    data: { position: { x: colIndex, y: rowIndex } },
  });

  return (
    <div
      ref={setDroppableRef}
      key={colIndex}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
      }}
      onClick={clickPosition(colIndex, rowIndex)}
    >
      <GamePiece
        colIndex={colIndex}
        rowIndex={rowIndex}
        boardState={boardState}
        color={color}
        hoverPosition={hoverPosition}
      />
      <SvgCross position={{ x: colIndex, y: rowIndex }} />
    </div>
  );
};

const getCurrentJumpInfo = (boardState: BoardState, x?: number, y?: number) => {
  const jumpIsInProgress = boardState.ongoingJump.length > 0;
  const lastJumpTarget =
    boardState.ongoingJump[boardState.ongoingJump.length - 1]?.to;
  const lastJumpedPositionIsThisTile =
    lastJumpTarget?.x === x && lastJumpTarget?.y === y;

  return { lastJumpedPositionIsThisTile, jumpIsInProgress };
};

const GamePiece = ({
  colIndex,
  rowIndex,
  boardState,
  hoverPosition,
  color,
}: {
  colIndex: number;
  rowIndex: number;
  boardState: BoardState;
  hoverPosition: (colIndex: number, rowIndex: number) => () => void;

  color: TileState;
}) => {
  const { lastJumpedPositionIsThisTile, jumpIsInProgress } = getCurrentJumpInfo(
    boardState,
    colIndex,
    rowIndex
  );

  const isDisabled =
    color !== boardState.currentTurn ||
    color === null ||
    (jumpIsInProgress && !lastJumpedPositionIsThisTile) ||
    gameIsOver(boardState);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    active,
  } = useDraggable({
    id: `piece-${rowIndex}-${colIndex}`,
    data: { position: { x: colIndex, y: rowIndex }, color },
    disabled: isDisabled,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 20,
      }
    : undefined;

  return (
    <div
      ref={setDraggableRef}
      onMouseEnter={hoverPosition(colIndex, rowIndex)}
      style={{
        cursor: active ? "grabbing" : isDisabled ? "default" : "grab",
        position: "absolute",
        zIndex: 10,
        borderRadius: 50,
        width: "100%",
        height: "100%",

        border:
          boardState.selectedPiece?.x === colIndex &&
          boardState.selectedPiece?.y === rowIndex
            ? "3px solid blue"
            : boardState.selectedPiecePaths?.filter(
                ({ x, y }) => x === colIndex && y === rowIndex
              ).length
            ? "3px solid orange"
            : "none",
        backgroundColor:
          color === "black"
            ? "black"
            : color === "white"
            ? "white"
            : "transparent",
        opacity: boardState.markedForRemoval.find(
          (pos) => pos.x === colIndex && pos.y === rowIndex
        )
          ? 0.7
          : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
      {...attributes}
      {...listeners}
    />
  );
};

const findConnectedCluster = (
  x: number,
  y: number,
  boardState: BoardState,
  targetColor: TileState = boardState.positions[y][x]
) => {
  if (targetColor === null) return [];

  const visited = new Set<string>();
  const cluster: { x: number; y: number }[] = [];
  const stack = [{ x, y }];

  while (stack.length > 0) {
    const { x: currX, y: currY } = stack.pop()!;
    const key = `${currX},${currY}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (boardState.positions[currY][currX] === targetColor) {
      cluster.push({ x: currX, y: currY });
    }

    for (const { dx, dy } of xyDirections) {
      const newX = currX + dx;
      const newY = currY + dy;
      if (
        newX >= 0 &&
        newX < boardSize &&
        newY >= 0 &&
        newY < boardSize &&
        boardState.positions[newY][newX] === targetColor &&
        !visited.has(`${newX},${newY}`)
      ) {
        stack.push({ x: newX, y: newY });
      }
    }
  }

  return cluster;
};

const positionOnTopEdge = (x: number, y: number) => {
  return y === 0;
};

const positionOnBottomEdge = (x: number, y: number) => {
  return y === 18;
};

const positionOnLeftEdge = (x: number, y: number) => {
  return x === 0;
};

const positionOnRightEdge = (x: number, y: number) => {
  return x === 18;
};

const positionInRightTopCorner = (x: number, y: number) => {
  return x === 18 && y === 0;
};

const positionInLeftTopCorner = (x: number, y: number) => {
  return x === 0 && y === 0;
};

const positionInRightBottomCorner = (x: number, y: number) => {
  return x === 18 && y === 18;
};

const positionInLeftBottomCorner = (x: number, y: number) => {
  return x === 0 && y === 18;
};

const SvgCross = ({
  position: { x, y },
}: {
  position: { x: number; y: number };
}) => {
  if (positionInLeftTopCorner(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line
          x1="50"
          y1="50"
          x2="100"
          y2="50"
          stroke="black"
          strokeWidth="10"
        />
        <line
          x1="50"
          y1="50"
          x2="50"
          y2="100"
          stroke="black"
          strokeWidth="10"
        />
      </svg>
    );
  }

  if (positionInRightTopCorner(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="0" y1="50" x2="50" y2="50" stroke="black" strokeWidth="10" />
        <line
          x1="50"
          y1="50"
          x2="50"
          y2="100"
          stroke="black"
          strokeWidth="10"
        />
      </svg>
    );
  }

  if (positionInLeftBottomCorner(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="50" y1="0" x2="50" y2="50" stroke="black" strokeWidth="10" />
        <line
          x1="

50"
          y1="50"
          x2="100"
          y2="50"
          stroke="black"
          strokeWidth="10"
        />
      </svg>
    );
  }

  if (positionInRightBottomCorner(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="0" y1="50" x2="50" y2="50" stroke="black" strokeWidth="10" />
        <line x1="50" y1="0" x2="50" y2="50" stroke="black" strokeWidth="10" />
      </svg>
    );
  }

  if (positionOnTopEdge(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="0" y1="50" x2="100" y2="50" stroke="black" strokeWidth="10" />
        <line
          x1="50"
          y1="50"
          x2="50"
          y2="100"
          stroke="black"
          strokeWidth="10"
        />
      </svg>
    );
  }

  if (positionOnBottomEdge(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="0" y1="50" x2="100" y2="50" stroke="black" strokeWidth="10" />
        <line x1="50" y1="0" x2="50" y2="50" stroke="black" strokeWidth="10" />
      </svg>
    );
  }

  if (positionOnLeftEdge(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="50" y1="0" x2="50" y2="100" stroke="black" strokeWidth="10" />
        <line
          x1="50"
          y1="50"
          x2="100"
          y2="50"
          stroke="black"
          strokeWidth="10"
        />
      </svg>
    );
  }

  if (positionOnRightEdge(x, y)) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="0" y1="50" x2="50" y2="50" stroke="black" strokeWidth="10" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="black" strokeWidth="10" />
      </svg>
    );
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="0" y1="50" x2="100" y2="50" stroke="black" strokeWidth="10" />
      <line x1="50" y1="0" x2="50" y2="100" stroke="black" strokeWidth="10" />
    </svg>
  );
};
