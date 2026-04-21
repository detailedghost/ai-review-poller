import { ApiError, AuthError, logWarn, NetworkError } from "../errors.ts";
import type { Ack, FetchOptions, PullRequest, Review, ReviewProvider } from "./types.ts";

const PR_URL_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
const BODY_EXCERPT_MAX = 240;

export const DEFAULT_NO_FINDINGS_PATTERN =
	/\bno\s+(?:additional|more|further)?\s*(?:code\s+)?changes\s+(?:are|were|will be)?\s*(?:needed|required|necessary)\b/i;

const GRAPHQL_QUERY = `
query {
  viewer {
    pullRequests(first: 50, states: OPEN) {
      nodes {
        url
        title
        reviews(last: 20) {
          nodes {
            databaseId
            submittedAt
            author { login }
            state
          }
        }
        comments(last: 20) {
          nodes {
            databaseId
            createdAt
            body
            author { login }
          }
        }
      }
    }
  }
}
`;

interface GraphQlReviewNode {
	databaseId: unknown;
	submittedAt: unknown;
	author: { login: unknown } | null | undefined;
	state: unknown;
}

interface GraphQlCommentNode {
	databaseId: unknown;
	createdAt: unknown;
	body: unknown;
	author: { login: unknown } | null | undefined;
}

interface GraphQlPrNode {
	url: unknown;
	title: unknown;
	reviews: { nodes: GraphQlReviewNode[] } | null | undefined;
	comments: { nodes: GraphQlCommentNode[] } | null | undefined;
}

interface GraphQlResponse {
	data?: {
		viewer?: {
			pullRequests?: {
				nodes?: GraphQlPrNode[];
			};
		};
	};
	errors?: Array<{ message: unknown }>;
}

function parseReview(node: GraphQlReviewNode): Review | null {
	const reviewId = node.databaseId;
	const submittedAt = node.submittedAt;
	const authorLogin = node.author?.login;

	if (!Number.isFinite(reviewId) || typeof reviewId !== "number") {
		logWarn("skipping review with non-finite databaseId", {
			databaseId: String(reviewId),
		});
		return null;
	}
	if (typeof submittedAt !== "string") {
		logWarn("skipping review with missing submittedAt", {
			databaseId: String(reviewId),
		});
		return null;
	}
	if (typeof authorLogin !== "string") {
		logWarn("skipping review with missing author login", {
			databaseId: String(reviewId),
		});
		return null;
	}

	return { reviewId, submittedAt, authorLogin };
}

function parseAck(node: GraphQlCommentNode, ackLogin: string, pattern: RegExp): Ack | null {
	const commentId = node.databaseId;
	const createdAt = node.createdAt;
	const authorLogin = node.author?.login;
	const body = node.body;

	if (typeof authorLogin !== "string" || authorLogin !== ackLogin) return null;
	if (typeof body !== "string" || !pattern.test(body)) return null;
	if (!Number.isFinite(commentId) || typeof commentId !== "number") return null;
	if (typeof createdAt !== "string") return null;

	const bodyExcerpt = body.slice(0, BODY_EXCERPT_MAX);
	return { commentId, createdAt, authorLogin, bodyExcerpt };
}

function parsePr(node: GraphQlPrNode, ackLogin: string, pattern: RegExp): PullRequest | null {
	const url = node.url;
	const title = node.title;

	if (typeof url !== "string" || !PR_URL_RE.test(url)) {
		logWarn("skipping PR with invalid url", {
			url: typeof url === "string" ? url : "[non-string]",
		});
		return null;
	}
	if (typeof title !== "string") {
		logWarn("skipping PR with missing title", { url });
		return null;
	}

	const reviewNodes = node.reviews?.nodes ?? [];
	const reviews: Review[] = [];
	for (const rn of reviewNodes) {
		const review = parseReview(rn);
		if (review !== null) reviews.push(review);
	}

	const commentNodes = node.comments?.nodes ?? [];
	const acks: Ack[] = [];
	for (const cn of commentNodes) {
		const ack = parseAck(cn, ackLogin, pattern);
		if (ack !== null) acks.push(ack);
	}

	return { url, title, reviews, acks };
}

async function getToken(): Promise<string> {
	const proc = Bun.spawn(["gh", "auth", "token"], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const token = stdout.trim();

	if (exitCode !== 0 || token === "") {
		throw new AuthError("auth.token_cmd_failed", "gh auth token failed", {
			details: { exitCode, stderr: stderr.slice(0, 500) },
		});
	}

	return token;
}

async function fetchOpenPullRequests(token: string, options: FetchOptions = {}): Promise<PullRequest[]> {
	const pattern = options.noFindingsPattern ?? DEFAULT_NO_FINDINGS_PATTERN;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);

	let response: Response;
	try {
		response = await fetch("https://api.github.com/graphql", {
			method: "POST",
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query: GRAPHQL_QUERY }),
		});
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new NetworkError("network.timeout", "GitHub GraphQL request timed out after 30s", {
				details: { timeoutMs: 30_000 },
			});
		}
		throw new NetworkError(
			"network.fetch_failed",
			`fetch failed: ${err instanceof Error ? err.message : String(err)}`,
			{
				details: { name: err instanceof Error ? err.name : "unknown" },
				cause: err,
			},
		);
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new ApiError("api.http_status", `GitHub GraphQL returned HTTP ${response.status}`, {
			details: { status: response.status, body: body.slice(0, 200) },
		});
	}

	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch (err) {
		throw new ApiError("api.malformed_body", "GitHub GraphQL response is not valid JSON", {
			cause: err,
		});
	}

	const body = parsed as GraphQlResponse;

	if (Array.isArray(body.errors) && body.errors.length > 0) {
		const messages = body.errors.map((e) => String(e.message));
		throw new ApiError("api.graphql_errors", `GraphQL errors: ${messages.join("; ")}`, {
			details: { errors: messages },
		});
	}

	const nodes = body.data?.viewer?.pullRequests?.nodes;
	if (!Array.isArray(nodes)) {
		throw new ApiError("api.malformed_body", "GitHub GraphQL response missing data.viewer.pullRequests.nodes", {
			details: { snippet: JSON.stringify(parsed).slice(0, 200) },
		});
	}

	const prs: PullRequest[] = [];
	for (const node of nodes) {
		const pr = parsePr(node as GraphQlPrNode, githubProvider.botAckLogin, pattern);
		if (pr !== null) prs.push(pr);
	}
	return prs;
}

export const githubProvider: ReviewProvider = {
	name: "github",
	botReviewerLogin: "copilot-pull-request-reviewer",
	botAckLogin: "copilot-swe-agent",
	getToken,
	fetchOpenPullRequests,
};

export default githubProvider;
