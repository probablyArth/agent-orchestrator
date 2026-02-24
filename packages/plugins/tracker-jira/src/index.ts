/**
 * tracker-jira plugin — Jira as an issue tracker.
 *
 * Supports two transports:
 *   1. Direct Jira REST API v3 with Basic Auth
 *      (JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN)
 *   2. Composio SDK (COMPOSIO_API_KEY, optional COMPOSIO_ENTITY_ID)
 *      Still requires JIRA_HOST for URL construction.
 *
 * When COMPOSIO_API_KEY is set, the Composio transport is preferred.
 */

import { request } from "node:https";
import type {
  PluginModule,
  Tracker,
  Issue,
  IssueFilters,
  IssueUpdate,
  CreateIssueInput,
  ProjectConfig,
} from "@composio/ao-core";
import type { Composio } from "@composio/core";

// ---------------------------------------------------------------------------
// Types for Jira responses
// ---------------------------------------------------------------------------

interface JiraStatusCategory {
  key: string; // "new" | "indeterminate" | "done" | "undefined"
  name: string;
}

interface JiraStatus {
  name: string;
  statusCategory: JiraStatusCategory;
}

/** Atlassian Document Format node */
interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

interface JiraIssueFields {
  summary: string;
  description: AdfNode | string | null;
  status: JiraStatus;
  labels: string[];
  assignee: { displayName: string; emailAddress?: string } | null;
  priority: { name: string; id: string } | null;
  issuetype: { name: string } | null;
  project: { key: string } | null;
}

interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

interface JiraTransition {
  id: string;
  name: string;
  to: {
    statusCategory: JiraStatusCategory;
  };
}

interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

// ---------------------------------------------------------------------------
// Transport abstraction — action-based interface
// ---------------------------------------------------------------------------

interface JiraTransportActions {
  getIssue(key: string, fields?: string): Promise<JiraIssue>;
  searchIssues(jql: string, maxResults: number, fields: string): Promise<JiraSearchResult>;
  getTransitions(key: string): Promise<JiraTransitionsResponse>;
  transitionIssue(key: string, transitionId: string): Promise<void>;
  updateIssueFields(key: string, fields: Record<string, unknown>): Promise<void>;
  addComment(key: string, body: unknown): Promise<void>;
  createIssue(fields: Record<string, unknown>): Promise<JiraIssue>;
}

// ---------------------------------------------------------------------------
// Direct Jira API transport
// ---------------------------------------------------------------------------

interface JiraCredentials {
  host: string;
  email: string;
  apiToken: string;
}

function getJiraCredentials(): JiraCredentials {
  const host = process.env["JIRA_HOST"];
  const email = process.env["JIRA_EMAIL"];
  const apiToken = process.env["JIRA_API_TOKEN"];
  if (!host || !email || !apiToken) {
    throw new Error(
      "JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are required for the Jira tracker plugin",
    );
  }
  return { host, email, apiToken };
}

/** Low-level HTTPS request helper for the direct transport. */
function jiraHttpRequest<T>(
  creds: JiraCredentials,
  auth: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const req = request(
      {
        hostname: creds.host,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Basic ${auth}`,
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", (err: Error) => settle(() => reject(err)));
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          settle(() => {
            try {
              const text = Buffer.concat(chunks).toString("utf-8");
              const status = res.statusCode ?? 0;
              if (status < 200 || status >= 300) {
                reject(new Error(`Jira API returned HTTP ${status}: ${text.slice(0, 200)}`));
                return;
              }
              // Some Jira endpoints return 204 with no body
              if (!text || text.trim() === "") {
                resolve(undefined as T);
                return;
              }
              resolve(JSON.parse(text) as T);
            } catch (err) {
              reject(err);
            }
          });
        });
      },
    );

    req.setTimeout(30_000, () => {
      settle(() => {
        req.destroy();
        reject(new Error("Jira API request timed out after 30s"));
      });
    });

    req.on("error", (err) => settle(() => reject(err)));
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

function createDirectTransport(): { actions: JiraTransportActions; host: string } {
  const creds = getJiraCredentials();
  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");

  const http = <T>(method: string, path: string, body?: unknown): Promise<T> =>
    jiraHttpRequest<T>(creds, auth, method, path, body);

  const actions: JiraTransportActions = {
    async getIssue(key, fields) {
      const qs = fields ? `?fields=${encodeURIComponent(fields)}` : "";
      return http<JiraIssue>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}${qs}`);
    },

    async searchIssues(jql, maxResults, fields) {
      const params = new URLSearchParams({
        jql,
        maxResults: String(maxResults),
        fields,
      });
      return http<JiraSearchResult>("GET", `/rest/api/3/search/jql?${params.toString()}`);
    },

    async getTransitions(key) {
      return http<JiraTransitionsResponse>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
      );
    },

    async transitionIssue(key, transitionId) {
      await http("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
        transition: { id: transitionId },
      });
    },

    async updateIssueFields(key, fields) {
      await http("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
    },

    async addComment(key, body) {
      await http("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body });
    },

    async createIssue(fields) {
      return http<JiraIssue>("POST", "/rest/api/3/issue", { fields });
    },
  };

  return { actions, host: creds.host };
}

// ---------------------------------------------------------------------------
// Composio SDK transport
// ---------------------------------------------------------------------------

type ComposioTools = Composio["tools"];

function createComposioTransport(apiKey: string, entityId: string): JiraTransportActions {
  // Lazy-load the Composio client — cached as a promise so the constructor
  // is called only once, even under concurrent requests.
  let clientPromise: Promise<ComposioTools> | undefined;

  function getClient(): Promise<ComposioTools> {
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const { Composio } = await import("@composio/core");
          const client = new Composio({ apiKey });
          return client.tools;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes("Cannot find module") ||
            msg.includes("Cannot find package") ||
            msg.includes("ERR_MODULE_NOT_FOUND")
          ) {
            throw new Error(
              "Composio SDK (@composio/core) is not installed. " +
                "Install it with: pnpm add @composio/core",
              { cause: err },
            );
          }
          throw err;
        }
      })();
    }
    return clientPromise;
  }

  async function exec<T>(action: string, args: Record<string, unknown>): Promise<T> {
    const tools = await getClient();

    const resultPromise = tools.execute(action, {
      entityId,
      arguments: args,
    });

    // Apply 30s timeout for parity with the direct transport
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Composio Jira API request timed out after 30s"));
      }, 30_000);
    });

    // Attach no-op .catch() to both promises so the loser of the race
    // doesn't trigger an unhandled promise rejection.
    resultPromise.catch(() => {});
    timeoutPromise.catch(() => {});

    try {
      const result = await Promise.race([resultPromise, timeoutPromise]);

      if (!result.successful) {
        throw new Error(`Composio Jira API error: ${result.error ?? "unknown error"}`);
      }

      if (!result.data) {
        throw new Error("Composio Jira API returned no data");
      }

      return result.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  const actions: JiraTransportActions = {
    async getIssue(key, fields) {
      return exec<JiraIssue>("JIRA_GET_ISSUE", {
        issue_id_or_key: key,
        ...(fields ? { fields } : {}),
      });
    },

    async searchIssues(jql, maxResults, fields) {
      return exec<JiraSearchResult>("JIRA_SEARCH_ISSUES", {
        jql,
        max_results: maxResults,
        fields,
      });
    },

    async getTransitions(key) {
      return exec<JiraTransitionsResponse>("JIRA_GET_TRANSITIONS", {
        issue_id_or_key: key,
      });
    },

    async transitionIssue(key, transitionId) {
      await exec("JIRA_TRANSITION_ISSUE", {
        issue_id_or_key: key,
        transition_id: transitionId,
      });
    },

    async updateIssueFields(key, fields) {
      await exec("JIRA_UPDATE_ISSUE", {
        issue_id_or_key: key,
        fields: JSON.stringify(fields),
      });
    },

    async addComment(key, body) {
      await exec("JIRA_ADD_COMMENT", {
        issue_id_or_key: key,
        body: JSON.stringify(body),
      });
    },

    async createIssue(fields) {
      return exec<JiraIssue>("JIRA_CREATE_ISSUE", {
        fields: JSON.stringify(fields),
      });
    },
  };

  return actions;
}

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

function mapJiraState(statusCategory: JiraStatusCategory, statusName: string): Issue["state"] {
  // Check for cancelled status by name
  if (statusName.toLowerCase().includes("cancel")) {
    return "cancelled";
  }

  switch (statusCategory.key) {
    case "done":
      return "closed";
    case "indeterminate":
      return "in_progress";
    case "new":
    default:
      return "open";
  }
}

/** Map priority name to a numeric value (1 = highest) */
function mapJiraPriority(priority: { name: string; id: string } | null): number | undefined {
  if (!priority) return undefined;
  // Jira default priority IDs: 1=Highest, 2=High, 3=Medium, 4=Low, 5=Lowest
  const id = parseInt(priority.id, 10);
  if (!isNaN(id) && id >= 1 && id <= 5) return id;
  return undefined;
}

// ---------------------------------------------------------------------------
// ADF -> plain text
// ---------------------------------------------------------------------------

/** Recursively extract plain text from an Atlassian Document Format tree. */
function adfToText(node: AdfNode): string {
  if (node.type === "text") return node.text ?? "";
  if (!node.content) return "";
  const parts = node.content.map(adfToText);
  // Add newlines between block-level nodes
  if (
    node.type === "doc" ||
    node.type === "paragraph" ||
    node.type === "bulletList" ||
    node.type === "orderedList" ||
    node.type === "listItem"
  ) {
    return parts.join("\n");
  }
  return parts.join("");
}

function extractDescription(desc: AdfNode | string | null): string {
  if (desc === null || desc === undefined) return "";
  if (typeof desc === "string") return desc;
  return adfToText(desc).trim();
}

// ---------------------------------------------------------------------------
// Helper: map JiraIssue to Issue
// ---------------------------------------------------------------------------

function mapIssue(jiraIssue: JiraIssue, host: string): Issue {
  const fields = jiraIssue.fields;
  return {
    id: jiraIssue.key,
    title: fields.summary,
    description: extractDescription(fields.description),
    url: `https://${host}/browse/${jiraIssue.key}`,
    state: mapJiraState(fields.status.statusCategory, fields.status.name),
    labels: fields.labels ?? [],
    assignee: fields.assignee?.displayName,
    priority: mapJiraPriority(fields.priority),
  };
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

function createJiraTracker(actions: JiraTransportActions, host: string): Tracker {
  return {
    name: "jira",

    async getIssue(identifier: string, _project: ProjectConfig): Promise<Issue> {
      const jiraIssue = await actions.getIssue(identifier);
      return mapIssue(jiraIssue, host);
    },

    async isCompleted(identifier: string, _project: ProjectConfig): Promise<boolean> {
      const jiraIssue = await actions.getIssue(identifier, "status");
      const cat = jiraIssue.fields.status.statusCategory.key;
      return cat === "done";
    },

    issueUrl(identifier: string, _project: ProjectConfig): string {
      return `https://${host}/browse/${identifier}`;
    },

    issueLabel(url: string, _project: ProjectConfig): string {
      // Extract issue key from Jira URL
      // Examples:
      //   https://mycompany.atlassian.net/browse/PROJ-123
      //   https://mycompany.atlassian.net/browse/PROJ-123?focusedId=12345
      const match = url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
      if (match) {
        return match[1];
      }
      // Fallback: return the last path segment
      const parts = url.split("/");
      return parts[parts.length - 1] || url;
    },

    branchName(identifier: string, _project: ProjectConfig): string {
      return `feat/${identifier}`;
    },

    async generatePrompt(identifier: string, project: ProjectConfig): Promise<string> {
      const issue = await this.getIssue(identifier, project);
      const lines = [
        `You are working on Jira ticket ${issue.id}: ${issue.title}`,
        `Issue URL: ${issue.url}`,
        "",
      ];

      if (issue.labels.length > 0) {
        lines.push(`Labels: ${issue.labels.join(", ")}`);
      }

      if (issue.priority !== undefined) {
        const priorityNames: Record<number, string> = {
          1: "Highest",
          2: "High",
          3: "Medium",
          4: "Low",
          5: "Lowest",
        };
        lines.push(`Priority: ${priorityNames[issue.priority] ?? String(issue.priority)}`);
      }

      if (issue.description) {
        lines.push("## Description", "", issue.description);
      }

      lines.push(
        "",
        "Please implement the changes described in this ticket. When done, commit and push your changes.",
      );

      return lines.join("\n");
    },

    async listIssues(filters: IssueFilters, project: ProjectConfig): Promise<Issue[]> {
      const projectKey = project.tracker?.["projectKey"] as string | undefined;

      // Build JQL clauses
      const clauses: string[] = [];

      if (projectKey) {
        clauses.push(`project = "${projectKey}"`);
      }

      if (filters.state === "closed") {
        clauses.push('statusCategory = "Done"');
      } else if (filters.state !== "all") {
        // Default to open (exclude done)
        clauses.push('statusCategory != "Done"');
      }

      if (filters.assignee) {
        clauses.push(`assignee = "${filters.assignee}"`);
      }

      if (filters.labels && filters.labels.length > 0) {
        for (const label of filters.labels) {
          clauses.push(`labels = "${label}"`);
        }
      }

      const jql = clauses.length > 0 ? clauses.join(" AND ") : "ORDER BY created DESC";
      const maxResults = filters.limit ?? 30;
      const fields = "summary,status,labels,assignee,priority,issuetype,project,description";

      const result = await actions.searchIssues(jql, maxResults, fields);
      return result.issues.map((issue) => mapIssue(issue, host));
    },

    async updateIssue(
      identifier: string,
      update: IssueUpdate,
      _project: ProjectConfig,
    ): Promise<void> {
      // Handle state change via transitions
      if (update.state) {
        const transitionsData = await actions.getTransitions(identifier);

        let targetCategoryKey: string;
        if (update.state === "closed") {
          targetCategoryKey = "done";
        } else if (update.state === "in_progress") {
          targetCategoryKey = "indeterminate";
        } else {
          targetCategoryKey = "new";
        }

        const transition = transitionsData.transitions.find(
          (t) => t.to.statusCategory.key === targetCategoryKey,
        );

        if (!transition) {
          throw new Error(
            `No transition found to status category "${targetCategoryKey}" for issue ${identifier}`,
          );
        }

        await actions.transitionIssue(identifier, transition.id);
      }

      // Handle field updates (labels, assignee)
      const fieldsUpdate: Record<string, unknown> = {};

      if (update.labels && update.labels.length > 0) {
        // Additive — fetch existing labels and merge
        const existing = await actions.getIssue(identifier, "labels");
        const existingLabels = new Set(existing.fields.labels ?? []);
        for (const label of update.labels) {
          existingLabels.add(label);
        }
        fieldsUpdate["labels"] = [...existingLabels];
      }

      if (update.assignee) {
        // Jira assignee is set by accountId; use displayName search
        // For simplicity, pass the name — works when assignee matches accountId or displayName
        fieldsUpdate["assignee"] = { name: update.assignee };
      }

      if (Object.keys(fieldsUpdate).length > 0) {
        await actions.updateIssueFields(identifier, fieldsUpdate);
      }

      // Handle comment
      if (update.comment) {
        await actions.addComment(identifier, {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: update.comment }],
            },
          ],
        });
      }
    },

    async createIssue(input: CreateIssueInput, project: ProjectConfig): Promise<Issue> {
      const projectKey = project.tracker?.["projectKey"] as string | undefined;
      if (!projectKey) {
        throw new Error("Jira tracker requires 'projectKey' in project tracker config");
      }

      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        summary: input.title,
        issuetype: { name: "Task" },
      };

      if (input.description) {
        fields["description"] = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: input.description }],
            },
          ],
        };
      }

      if (input.labels && input.labels.length > 0) {
        fields["labels"] = input.labels;
      }

      if (input.assignee) {
        fields["assignee"] = { name: input.assignee };
      }

      if (input.priority !== undefined) {
        fields["priority"] = { id: String(input.priority) };
      }

      const created = await actions.createIssue(fields);

      // Fetch full issue details since create response may be partial
      const full = await actions.getIssue(created.key);

      return mapIssue(full, host);
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin module export
// ---------------------------------------------------------------------------

export const manifest = {
  name: "jira",
  slot: "tracker" as const,
  description: "Tracker plugin: Jira issue tracker",
  version: "0.1.0",
};

export function create(): Tracker {
  const host = process.env["JIRA_HOST"];
  if (!host) {
    throw new Error("JIRA_HOST environment variable is required for the Jira tracker plugin");
  }

  const composioKey = process.env["COMPOSIO_API_KEY"];
  if (composioKey) {
    const entityId = process.env["COMPOSIO_ENTITY_ID"] ?? "default";
    return createJiraTracker(createComposioTransport(composioKey, entityId), host);
  }

  const { actions } = createDirectTransport();
  return createJiraTracker(actions, host);
}

export default { manifest, create } satisfies PluginModule<Tracker>;
