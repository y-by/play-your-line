import { useEffect, useRef } from "react";
import { SignInGate } from "../components/SignInGate";
import { AppShell } from "../components/AppShell";
import { HELP_GROUPS, HELP_TOPICS } from "../lib/helpContent";

function HelpContent() {
  const wanted = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const target = useRef<HTMLDetailsElement>(null);

  // Coming from a "?" in the editor: open and show that question.
  useEffect(() => {
    target.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <AppShell title="Help">
      <main className="help-page">
        <p className="settings-note">Short answers about how Play Your Line works. Press a question to open it.</p>
        {HELP_GROUPS.map((group) => (
          <section key={group} className="help-group">
            <h3>{group}</h3>
            {HELP_TOPICS.filter((t) => t.group === group).map((t) => (
              <details key={t.id} id={t.id} className="help-item" open={t.id === wanted} ref={t.id === wanted ? target : undefined}>
                <summary>{t.question}</summary>
                {t.answer.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </details>
            ))}
          </section>
        ))}
      </main>
    </AppShell>
  );
}

export function HelpPage() {
  return (
    <SignInGate>
      <HelpContent />
    </SignInGate>
  );
}
