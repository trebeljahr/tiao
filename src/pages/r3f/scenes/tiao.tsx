import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  UniqueIdentifier,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useCallback, useEffect, useState } from "react";

export default function Page() {
  return (
    <div className="w-screen h-screen bg-orange-300">
      <h1 className="text-black">Tiao 条</h1>
      <TiaoBoard />
    </div>
  );
}

type TileState = "black" | "white" | null;

type History = {
  moves: { x: number; y: number; color: "black" | "white" }[];
};

type BoardState = {
  positions: TileState[][];
  highlightedCluster: { x: number; y: number }[] | null;
  currentTurn: "black" | "white";
  selectedPiece: { x: number; y: number } | null;
  selectedPiecePaths: { x: number; y: number }[] | null;
  history: History;
};

const initialBoardState: BoardState = {
  positions: Array(19).fill(Array(19).fill(null)),
  highlightedCluster: null,
  currentTurn: "white",
  selectedPiece: null,
  selectedPiecePaths: null,
  history: { moves: [] },
};

const TiaoBoard = () => {
  const [boardState, setBoardState] = useState(initialBoardState);

  const hoverPosition = (x: number, y: number) => () => {
    if (
      boardState.positions[y][x] === null ||
      boardState.currentTurn !== boardState.positions[y][x]
    ) {
      return;
    }

    const connectedCluster = findConnectedCluster(x, y, boardState);

    setBoardState((prevState) => ({
      positions: prevState.positions,
      highlightedCluster: connectedCluster,
      currentTurn: prevState.currentTurn,
      selectedPiece: { x, y },
      selectedPiecePaths: findJumpingPaths(x, y, boardState.positions[y][x]!),
      history: prevState.history,
    }));
  };

  const clickPosition = (x: number, y: number) => () => {
    if (boardState.positions[y][x] !== null) {
      return;
    }

    setBoardState((state) => {
      const newPositions = state.positions.map((row) => row.slice());

      const cluster = findConnectedCluster(x, y, state, state.currentTurn);

      if (cluster.length > 10) {
        console.log("cluster too big, cannot place piece");
        return state;
      }

      if (newPositions[y][x] === null) {
        newPositions[y][x] = state.currentTurn;
      }

      return {
        positions: newPositions,
        highlightedCluster: null,
        currentTurn: state.currentTurn === "white" ? "black" : "white",
        selectedPiece: null,
        selectedPiecePaths: null,
        history: {
          moves: [...state.history.moves, { x, y, color: state.currentTurn }],
        },
      };
    });
  };

  const findJumpingPaths = (x: number, y: number, color: "black" | "white") => {
    const directions = [
      { dx: 2, dy: 0 },
      { dx: -2, dy: 0 },
      { dx: 0, dy: 2 },
      { dx: 0, dy: -2 },

      // diagonals
      { dx: 2, dy: 2 },
      { dx: -2, dy: -2 },
      { dx: 2, dy: -2 },
      { dx: -2, dy: 2 },
    ];

    const paths = [] as { x: number; y: number }[];
    for (const { dx, dy } of directions) {
      const midX = x + dx / 2;
      const midY = y + dy / 2;

      if (midX < 0 || midX >= 19 || midY < 0 || midY >= 19) {
        continue;
      }

      const midPiece = boardState.positions[midY][midX];
      if (midPiece === null || midPiece === color) {
        continue;
      }

      const newX = x + dx;
      const newY = y + dy;
      if (
        newX >= 0 &&
        newX < 19 &&
        newY >= 0 &&
        newY < 19 &&
        boardState.positions[newY][newX] === null
      ) {
        paths.push({ x: newX, y: newY });

        // const tempPiece = boardState.positions[y][x];
        // const tempMidPiece = boardState.positions[midY][midX];
        // boardState.positions[y][x] = null;
        // boardState.positions[midY][midX] = null;
        // const furtherPaths = findJumpingPaths(newX, newY, color);
        // boardState.positions[y][x] = tempPiece;
        // boardState.positions[midY][midX] = tempMidPiece;

        // for (const path of furtherPaths) {
        //   if (!paths.find((p) => p.x === path.x && p.y === path.y)) {
        //     paths.push(path);
        //   }
        // }
      }
    }

    return paths;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      console.log(event);

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
        const { x, y } = over.data.current?.position as {
          x: number;
          y: number;
        };

        const dropOffPosition = state.positions[y][x];
        if (dropOffPosition !== null) {
          return state;
        }

        console.log(boardState.selectedPiecePaths);
        console.log(`Dropped on (${x}, ${y})`);

        const possiblePathMatches = boardState.selectedPiecePaths?.filter(
          ({ x: x2, y: y2 }) => x === x2 && y === y2
        );

        console.log(possiblePathMatches);

        const droppedOnPossiblePath = possiblePathMatches?.length === 1;

        if (!droppedOnPossiblePath) {
          return state;
        }

        console.log(
          `Moving piece from (${movingStone.position.x}, ${movingStone.position.y}) to (${x}, ${y})`
        );

        state.positions[movingStone.position.y][movingStone.position.x] = null;
        state.positions[y][x] = pieceColor;

        return {
          positions: state.positions,
          highlightedCluster: null,
          currentTurn: state.currentTurn === "white" ? "black" : "white",
          selectedPiece: null,
          selectedPiecePaths: null,
          history: {
            moves: [...state.history.moves, { x, y, color: state.currentTurn }],
          },
        };
      });
    },
    [boardState.selectedPiecePaths]
  );

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        style={{
          gridTemplateRows: "repeat(19, 1fr)",
          gridTemplateColumns: "repeat(19, 1fr)",
          width: "90vmin",
          height: "90vmin",
        }}
      >
        {boardState.positions.map((row, rowIndex) => (
          <div
            key={rowIndex}
            style={{
              display: "flex",
            }}
          >
            {row.map((color, colIndex) => (
              <GameBoardSlot
                colIndex={colIndex}
                rowIndex={rowIndex}
                boardState={boardState}
                setBoardState={setBoardState}
                hoverPosition={hoverPosition}
                clickPosition={clickPosition}
                color={color}
                key={colIndex}
              />
            ))}
          </div>
        ))}
      </div>

      <h2>Current Turn: {boardState.currentTurn}</h2>
      <p>{boardState.history.moves.length} moves made.</p>
    </DndContext>
  );
};

const GameBoardSlot = ({
  colIndex,
  rowIndex,
  setBoardState,
  boardState,
  hoverPosition,
  clickPosition,
  color,
}: {
  colIndex: number;
  rowIndex: number;
  setBoardState: React.Dispatch<React.SetStateAction<BoardState>>;
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
        // pointerEvents: "none",
      }}
      onClick={clickPosition(colIndex, rowIndex)}
    >
      <GamePiece
        colIndex={colIndex}
        rowIndex={rowIndex}
        boardState={boardState}
        color={color}
        setBoardState={setBoardState}
        hoverPosition={hoverPosition}
      />
      <SvgCross position={{ x: colIndex, y: rowIndex }} />
    </div>
  );
};

const GamePiece = ({
  colIndex,
  rowIndex,
  boardState,
  hoverPosition,
  setBoardState,
  color,
}: {
  colIndex: number;
  rowIndex: number;
  boardState: BoardState;
  setBoardState: React.Dispatch<React.SetStateAction<BoardState>>;
  hoverPosition: (colIndex: number, rowIndex: number) => () => void;

  color: TileState;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    active,
  } = useDraggable({
    id: `piece-${rowIndex}-${colIndex}`,
    data: { position: { x: colIndex, y: rowIndex }, color },
    disabled: color !== boardState.currentTurn,
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
        cursor: active
          ? "grabbing"
          : color === boardState.currentTurn
          ? "grab"
          : "default",
        position: "absolute",
        zIndex: 20,
        borderRadius: 50,
        width: "100%",
        height: "100%",

        border:
          boardState.selectedPiece?.x === colIndex &&
          boardState.selectedPiece?.y === rowIndex
            ? "3px solid blue"
            : boardState.highlightedCluster?.filter(
                ({ x, y }) => x === colIndex && y === rowIndex
              ).length
            ? "3px solid green"
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
    cluster.push({ x: currX, y: currY });
    const directions = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    for (const { dx, dy } of directions) {
      const newX = currX + dx;
      const newY = currY + dy;
      if (
        newX >= 0 &&
        newX < 19 &&
        newY >= 0 &&
        newY < 19 &&
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
