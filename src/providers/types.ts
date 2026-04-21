export interface Review {
	reviewId: number;
	submittedAt: string;
	authorLogin: string;
}

export interface Ack {
	commentId: number;
	createdAt: string;
	authorLogin: string;
	bodyExcerpt: string;
}

export interface PullRequest {
	url: string;
	title: string;
	reviews: Review[];
	acks?: Ack[];
}

export interface FetchOptions {
	noFindingsPattern?: RegExp;
}

export interface ReviewProvider {
	readonly name: string;
	readonly botReviewerLogin: string;
	readonly botAckLogin: string;
	getToken(): Promise<string>;
	fetchOpenPullRequests(token: string, options?: FetchOptions): Promise<PullRequest[]>;
}
