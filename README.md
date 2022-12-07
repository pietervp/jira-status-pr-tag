<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/actions/typescript-action/workflows/build-test/badge.svg"></a>
</p>

# Sync Jira Issue status to Open PRs

## Usage

```
      - uses: pietervp/jira-status-pr-tag@v0.0.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          ticket-regex: 'EDT-\d+' # regex to find ticket number in PR title / body
          jira-host: example.jira.com/
          jira-protocol: https
          jira-username:  ${{ secrets.JIRA_USER }}
          jira-password:  ${{ secrets.JIRA_PASSWD }}
```