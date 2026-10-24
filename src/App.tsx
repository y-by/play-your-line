import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthStore } from "./store/useAuthStore";
import { HomePage } from "./pages/HomePage";
import { SongPage } from "./pages/SongPage";
import { SongsListPage } from "./pages/SongsListPage";
import { InvitePage } from "./pages/InvitePage";
import { HelpPage } from "./pages/HelpPage";
import { JoinPage } from "./pages/JoinPage";
import { Tooltips } from "./components/Tooltips";
import { SignInGate } from "./components/SignInGate";
import { AccountWatch } from "./components/AccountWatch";
import { NoticePopup } from "./components/NoticePopup";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { AdminPage } from "./pages/AdminPage";
import "./app.css";

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <BrowserRouter>
      <Tooltips />
      <AccountWatch />
      <NoticePopup />
      <FeedbackDialog />
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
        <Route path="/help" element={<HelpPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/join/:token" element={<JoinPage />} />
      </Routes>
    </BrowserRouter>
  );
}
