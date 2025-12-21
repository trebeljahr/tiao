import { Route, Routes } from "react-router-dom";
// import { Navbar } from "./components/Navbar";
import { HomePage } from "./pages/HomePage";

export function App() {
  return (
    <div className="prose prose-a:no-underline w-screen min-h-screen max-w-none flex flex-col">
      {/* <Navbar /> */}

      <main className="w-screen min-h-screen bg-gray-100 flex-grow">
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </main>
      <footer className="text-center text-white py-4 bg-gray-900">
        <p>&copy; {new Date().getFullYear()} wherearemyfriends.info</p>
      </footer>
    </div>
  );
}
