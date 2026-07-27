export type ClassificationRule = {
  field: "campaign_name" | "adset_name" | "ad_name" | "objective" | "destination_url";
  operator: "contains" | "starts_with" | "equals" | "regex";
  value: string;
  projectId?: string;
  directionId?: string;
  resultDefinitionId?: string;
  priority: number;
};

export function normalizeCreativeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("uk-UA");
}

export function matchesRule(input: string, rule: ClassificationRule): boolean {
  const normalizedInput = input.trim().toLocaleLowerCase("uk-UA");
  const normalizedValue = rule.value.trim().toLocaleLowerCase("uk-UA");

  switch (rule.operator) {
    case "contains":
      return normalizedInput.includes(normalizedValue);
    case "starts_with":
      return normalizedInput.startsWith(normalizedValue);
    case "equals":
      return normalizedInput === normalizedValue;
    case "regex":
      return new RegExp(rule.value, "i").test(input);
  }
}
