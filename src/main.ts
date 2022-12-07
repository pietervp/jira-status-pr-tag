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

    const regexSource = core.getInput('ticket-regex')
    const regex = new RegExp(regexSource)

    // map the PRs to the ticket keys in the title or body of the PR (if any) and filter out any undefined values (i.e. no matches)
    const tickets = response.data
      .map(pr => {
        return {
          pull: pr.number,
          pullLabels: pr.labels.map(l => l.name),
          ticket: regex.exec(`${pr.title}${pr.body}`)?.shift()
        }
      })
      .filter((v: {ticket: string | undefined}) => v.ticket !== undefined)

    // log the tickets
    core.info(`tickets: ${JSON.stringify(tickets)}`)

    // use the jira api to create a query to list all tickets in the list of tickets
    const jql = `key in (${tickets
      .map((v: {ticket: string | undefined}) => v.ticket)
      .join(',')})`

    // log the jql
    core.info(`jql: ${jql}`)

    // execute the query
    const jiraTickets = await jiraApi.searchJira(jql)

    // extract the ticket status and labels from the response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ticketStatuses: any[] = jiraTickets.issues.map((issue: any) => {
      return {
        ticket: issue.key,
        status: issue.fields.status.name,
        labels: issue.fields.labels
      }
    })

    // log the ticket statuses
    core.info(`ticketStatuses: ${JSON.stringify(ticketStatuses)}`)

    // join the ticket statuses with the tickets from the PRs on the ticket key
    const ticketStatusesWithPrs = tickets.map(ticket => {
      const ticketStatus = ticketStatuses.find(v => v.ticket === ticket.ticket)
      return {
        pull: ticket.pull,
        ticket: ticket.ticket,
        ticketStatus: ticketStatus?.status,
        ticketLabels: ticketStatus?.labels,
        prLabels: ticket.pullLabels
      }
    })

    // log the ticket statuses with PRs
    core.info(`ticketStatusesWithPrs: ${JSON.stringify(ticketStatusesWithPrs)}`)

    // map ticketstatuseswihprs to a list of labels to add to the PR
    const labelsToAdd = ticketStatusesWithPrs.map(ticket => {
      // replace spaces with underscores and lowercase the status
      const statusClean = ticket.ticketStatus?.toLowerCase().replace(/\s/g, '_')
      // filter out any existing jira labels and add the new jira label
      let newLabels = ticket.prLabels
        .filter(l => !l.startsWith('jira:'))
        .concat(`jira:${statusClean}`)
      // add the jira labels to the list of labels to add
      if (ticket.ticketLabels) {
        newLabels = newLabels.concat(
          ticket.ticketLabels.map((l: string) => `jira::label:${l}`)
        )
      }
      return {
        pull: ticket.pull,
        newLabels,
        oldLabels: ticket.prLabels
      }
    })

    // log the labels to add
    core.info(`labelsToAdd: ${JSON.stringify(labelsToAdd)}`)

    // now filter the list to only contain items where newlabels is not equal to oldlabels
    const labelsToAddFiltered = labelsToAdd.filter(
      (v: {newLabels: string[]; oldLabels: string[]}) =>
        v.newLabels.join(',') !== v.oldLabels.join(',')
    )

    // log the labels to add
    core.info(`labelsToAddFiltered: ${JSON.stringify(labelsToAddFiltered)}`)

    // for all results execute the github api to add the labels to the PR
    for (const label of labelsToAddFiltered) {
      core.info(`Adding labels to PR ${label.pull}`)
      core.info(`New labels: ${label.newLabels}`)
      core.info(`Old labels: ${label.oldLabels}`)
      try {
        await octokit.rest.issues.addLabels({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: label.pull,
          labels: label.newLabels
        })
      } catch (error) {
        core.info(`Error adding labels to PR ${label.pull}`)
        core.info(`Error: ${error}`)
      }
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
