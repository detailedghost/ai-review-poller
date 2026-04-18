export interface Review {
	reviewId: number;
	submittedAt: string;
	authorLogin: string;
}

export interface PullRequest {
	url: string;
	title: string;
	reviews: Review[];
}

export interface ReviewProvider {
	readonly name: string;
	readonly botReviewerLogin: string;
	getToken(): Promise<string>;
	fetchOpenPullRequests(token: string): Promise<PullRequest[]>;
}
