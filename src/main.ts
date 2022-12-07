import * as core from '@actions/core'
import * as github from '@actions/github'
import * as jira from 'jira-client'

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token')
    const octokit = github.getOctokit(token)

    const response = await octokit.rest.pulls.list({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      state: 'open'
    })

    if (response.status !== 200) {
      core.info('Could not retrieve PR details')
      return
    }

    const jiraApi = new jira.default({
      host: core.getInput('jira-host'),
      protocol: core.getInput('jira-protocol'),
      username: core.getInput('jira-username'),
      password: core.getInput('jira-password')
    })

    for (const pr of response.data) {
      try {
        const searchString = `${pr.title}${pr.body}`
        const regexSource = core.getInput('ticket-regex')

        const regex = new RegExp(regexSource)
        const matches = regex.exec(searchString)

        if (!matches || matches?.length === 0) {
          core.info('Could not find any jira tickets in PR')
          continue
        }

        const ticketKey = matches[0]

        core.info(`ticketKey: ${ticketKey}`)

        const ticket = await jiraApi.getIssue(ticketKey)

        if (!ticket || !ticket.fields) {
          core.info(
            'Could not find any jira tickets in PR, or no fields property'
          )
          continue
        }

        if (!ticket.fields.status) {
          core.info('No status included in response')
          continue
        }

        const status: string = ticket.fields.status.name

        core.info(status)

        if (!status) {
          core.debug(JSON.stringify(ticket))
          core.info('Could not retrieve ticket status')
          continue
        }

        const statusClean = status.toLowerCase().replace(/\s/g, '_')
        core.info(`status: ${status}`)
        core.info(`statusClean: ${statusClean}`)

        let newLabels = pr.labels
          .map(f => f.name)
          .filter((l) => !l.startsWith('jira:'))

        newLabels.push(`jira:${statusClean}`)

        if (ticket.fields.labels) {
          newLabels = newLabels.concat(
            ticket.fields.labels.map((l: string) => `jira::label:${l}`)
          )
        }

        core.info('New labels: ');
        core.info(JSON.stringify(newLabels));

        // Add the labels to the pull request
        await octokit.request(
          'PUT /repos/{owner}/{repo}/issues/{issue_number}/labels',
          {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: pr.number,
            labels: newLabels
          }
        )
      } catch (error) {
        core.info(`Error parsing ${pr.title} => ${JSON.stringify(error)}`)
      }
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
