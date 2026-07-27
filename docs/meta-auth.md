# Meta authentication modes

Zvedeno supports two server-side Meta authentication modes.

## OAuth user connection

The service owner configures `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_API_VERSION`, and `META_REDIRECT_URI`. A user then clicks **Connect through Facebook**. The callback exchanges the short-lived code token for a long-lived user token and rejects the connection if Meta does not return a long-lived token.

## System User connection

For an owner-controlled Business Portfolio, configure `META_SYSTEM_USER_TOKEN` in addition to the Meta App credentials. The token is validated through Meta's token debugger endpoint and stored encrypted. If Meta reports no expiration, Zvedeno stores it as a permanent connection.

Never commit `.env` or tokens to GitHub.
