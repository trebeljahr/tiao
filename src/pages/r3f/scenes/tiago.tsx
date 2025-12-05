import { useState } from "react";

export default function Page() {
  return (
    <div className="w-screen h-screen bg-orange-300">
      <h1 className="text-black">Tiago 天高</h1>
      <TiagoBoard />
    </div>
  );
}

type PieceState = "black" | "white" | null;

type History = {
  moves: { x: number; y: number; color: "black" | "white" }[];
};

type BoardState = {
  positions: PieceState[][];
  highlightedCluster: { x: number; y: number }[] | null;
  currentTurn: "black" | "white";
  selectedPiece: { x: number; y: number } | null;
  history: History;
};

const initialBoardState: BoardState = {
  positions: Array(19).fill(Array(19).fill(null)),
  highlightedCluster: null,
  currentTurn: "white",
  selectedPiece: null,
  history: { moves: [] },
};

const TiagoBoard = () => {
  const [boardState, setBoardState] = useState(initialBoardState);

  const clickPosition = (x: number, y: number) => () => {
    if (boardState.positions[y][x] !== null) {
      const connectedCluster = findConnectedCluster(x, y);

      setBoardState((prevState) => ({
        positions: prevState.positions,
        highlightedCluster: connectedCluster,
        currentTurn: prevState.currentTurn,
        selectedPiece: { x, y },
        history: prevState.history,
      }));

      return;
    }

    setBoardState((state) => {
      const newPositions = state.positions.map((row) => row.slice());
      if (newPositions[y][x] === null) {
        newPositions[y][x] = state.currentTurn;
      }
      return {
        positions: newPositions,
        highlightedCluster: null,
        currentTurn: state.currentTurn === "white" ? "black" : "white",
        selectedPiece: null,
        history: {
          moves: [...state.history.moves, { x, y, color: state.currentTurn }],
        },
      };
    });
  };

  const findConnectedCluster = (x: number, y: number) => {
    const targetColor = boardState.positions[y][x];
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

  return (
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
          {row.map((cell, colIndex) => (
            <div
              key={colIndex}
              style={{
                width: 35,
                height: 35,
                position: "relative",
              }}
              onClick={clickPosition(colIndex, rowIndex)}
            >
              <div
                style={{
                  position: "absolute",
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
                      : "none",
                  backgroundColor:
                    cell === "black"
                      ? "black"
                      : cell === "white"
                      ? "white"
                      : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              />
              <SvgCross position={{ x: colIndex, y: rowIndex }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

const positionIsOnEdge = (x: number, y: number) => {
  return x === 0 || x === 18 || y === 0 || y === 18;
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
