import { ApiKeySection } from "@/components/settings/api-key-section";
import { FailModeSection } from "@/components/settings/fail-mode-section";
import { PasswordSection } from "@/components/settings/password-section";
import { SlackSection } from "@/components/settings/slack-section";
import { TeamSection } from "@/components/settings/team-section";
import { BackendError, getSettings } from "@/lib/backend";

export default async function SettingsPage() {
  let settings;
  try {
    settings = await getSettings();
  } catch (err) {
    const message = err instanceof BackendError ? err.message : "Unexpected error loading settings.";
    return (
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="login-error">Couldn&apos;t load settings: {message}</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h1 className="page-title">Settings</h1>
      <ApiKeySection />
      <PasswordSection />
      <FailModeSection initialFailMode={settings.fail_mode} />
      <SlackSection initialWebhookUrl={settings.slack_webhook_url} />
      <TeamSection
        team={settings.team}
        pendingInvites={settings.pending_invites}
        isAdmin={settings.your_role === "admin"}
      />
    </div>
  );
}
