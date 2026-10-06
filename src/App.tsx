import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthStore } from "./store/useAuthStore";
import { HomePage } from "./pages/HomePage";
import { SongPage } from "./pages/SongPage";
import { SongsListPage } from "./pages/SongsListPage";
import { InvitePage } from "./pages/InvitePage";
import { JoinPage } from "./pages/JoinPage";
import { Tooltips } from "./components/Tooltips";
import { SignInGate } from "./components/SignInGate";
import "./app.css";

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <BrowserRouter>
      <Tooltips />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/song/:id"
          element={
            <SignInGate>
              <SongPage />
            </SignInGate>
          }
        />
        <Route path="/songs" element={<SongsListPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/join/:token" element={<JoinPage />} />
      </Routes>
    </BrowserRouter>
  );
}
