import ReactDOM from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import { App } from "./App";
// import { AuthProviderWrapper } from "./context/auth.context";
// import { DataProvider } from "./context/DataContext";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <Router>
    {/* <AuthProviderWrapper>
      <DataProvider> */}
    <App />
    {/* </DataProvider>
    </AuthProviderWrapper> */}
  </Router>
);
