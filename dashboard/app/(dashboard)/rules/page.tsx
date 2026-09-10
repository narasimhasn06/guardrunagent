import { ActivityLogTable } from "@/components/rules/activity-log-table";
import { ActivityPagination } from "@/components/rules/activity-pagination";
import { NewRuleForm } from "@/components/rules/new-rule-form";
import { RulesTable } from "@/components/rules/rules-table";
import { RulesTabs, type RulesTab } from "@/components/rules/rules-tabs";
import { StarterRulesButton } from "@/components/rules/starter-rules-button";
import { BackendError, getGuardrailActivity, getRules } from "@/lib/backend";

function isTab(value: string | undefined): value is RulesTab {
  return value === "activity";
}

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; offset?: string }>;
}) {
  const params = await searchParams;
  const tab: RulesTab = isTab(params.tab) ? "activity" : "rules";
  const offset = Number(params.offset) || 0;

  try {
    if (tab === "rules") {
      const rules = await getRules();
      return (
        <div className="rules-page">
          <header className="home-header">
            <h1 className="page-title">Guardrail Rules</h1>
            <RulesTabs current={tab} />
          </header>

          <div className="rules-toolbar">
            <NewRuleForm />
            <StarterRulesButton />
          </div>

          <RulesTable rules={rules} />
        </div>
      );
    }

    const activityData = await getGuardrailActivity(offset);
    return (
      <div className="rules-page">
        <header className="home-header">
          <h1 className="page-title">Guardrail Rules</h1>
          <RulesTabs current={tab} />
        </header>

        <ActivityLogTable activity={activityData.activity} />
        <ActivityPagination total={activityData.total_count} limit={activityData.limit} offset={activityData.offset} />
      </div>
    );
  } catch (err) {
    const message = err instanceof BackendError ? err.message : "Unexpected error loading guardrail rules.";
    return (
      <div>
        <h1 className="page-title">Guardrail Rules</h1>
        <p className="login-error">Couldn&apos;t load guardrail rules: {message}</p>
      </div>
    );
  }
}
