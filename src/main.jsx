import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import SupportWindow from "./SupportWindow.jsx";
import "./styles.css";

const mode =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mode") : null;

const Root = mode === "support" ? SupportWindow : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
