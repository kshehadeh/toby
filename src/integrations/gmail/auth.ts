import http from "node:http";
import { google } from "googleapis";
import open from "open";
import type { GmailCredentials } from "../../config/index";

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.modify",
];
const REDIRECT_PORT = 9876;
const REDIRECT_PATH = "/callback";

export async function runOAuthFlow(
	credentials: GmailCredentials,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
	const oauth2Client = new google.auth.OAuth2(
		credentials.clientId,
		credentials.clientSecret,
		`http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`,
	);

	const authUrl = oauth2Client.generateAuthUrl({
		access_type: "offline",
		scope: SCOPES,
		prompt: "consent",
	});

	const code = await captureAuthCode(authUrl, REDIRECT_PORT, REDIRECT_PATH);
	const { tokens } = await oauth2Client.getToken(code);

	if (!tokens.access_token || !tokens.refresh_token) {
		throw new Error("Failed to obtain access or refresh token from Google");
	}

	return {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: tokens.expiry_date ?? Date.now() + 3600_000,
	};
}

function captureAuthCode(
	authUrl: string,
	port: number,
	path: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "", `http://localhost:${port}`);
			if (url.pathname !== path) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");

			if (error) {
				res.writeHead(400);
				res.end(`OAuth error: ${error}`);
				server.close();
				reject(new Error(`OAuth error: ${error}`));
				return;
			}

			if (!code) {
				res.writeHead(400);
				res.end("No authorization code received");
				server.close();
				reject(new Error("No authorization code received"));
				return;
			}

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<h1>Gmail connected! You can close this tab.</h1>");
			server.close();
			resolve(code);
		});

		server.listen(port, () => {
			console.log("Opening browser for Gmail authorization...");
			open(authUrl).catch(() => {
				console.log(
					`Could not open browser. Visit this URL manually:\n${authUrl}`,
				);
			});
		});

		server.on("error", (err) => {
			reject(new Error(`Local server error: ${err.message}`));
		});
	});
}
