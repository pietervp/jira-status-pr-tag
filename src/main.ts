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
      .join(',')})&fields=status,labels`

    // execute the query
    const jiraTickets = await jiraApi.searchJira(jql)

    core.info(`jql: ${jql}`)
    core.info(`jiraTickets: ${JSON.stringify(jiraTickets)}`)

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
      const newLabels = ticket.prLabels
        .filter(l => !l.startsWith('jira:'))
        .concat(`jira:${statusClean}`)
      // add the jira labels to the list of labels to add
      if (ticket.ticketLabels) {
        newLabels.concat(
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
      await octokit.rest.issues.addLabels({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: label.pull,
        labels: label.newLabels
      })
    }

    // for (const pr of response.data) {
    //   try {
    //     const searchString = `${pr.title}${pr.body}`
    //     const matches = regex.exec(searchString)

    //     if (!matches || matches?.length === 0) {
    //       core.info('Could not find any jira tickets in PR')
    //       continue
    //     }

    //     const ticketKey = matches[0]

    //     core.info(`ticketKey: ${ticketKey}`)

    //     const ticket = await jiraApi.getIssue(ticketKey)

    //     if (!ticket || !ticket.fields) {
    //       core.info(
    //         'Could not find any jira tickets in PR, or no fields property'
    //       )
    //       continue
    //     }

    //     if (!ticket.fields.status) {
    //       core.info('No status included in response')
    //       continue
    //     }

    //     const status: string = ticket.fields.status.name

    //     core.info(status)

    //     if (!status) {
    //       core.debug(JSON.stringify(ticket))
    //       core.info('Could not retrieve ticket status')
    //       continue
    //     }

    //     const statusClean = status.toLowerCase().replace(/\s/g, '_')
    //     core.info(`status: ${status}`)
    //     core.info(`statusClean: ${statusClean}`)

    //     let newLabels = pr.labels
    //       .map(f => f.name)
    //       .filter(l => !l.startsWith('jira:'))

    //     newLabels.push(`jira:${statusClean}`)

    //     if (ticket.fields.labels) {
    //       newLabels = newLabels.concat(
    //         ticket.fields.labels.map((l: string) => `jira::label:${l}`)
    //       )
    //     }

    //     core.info('New labels: ')
    //     core.info(JSON.stringify(newLabels))

    //     // Add the labels to the pull request
    //     await octokit.request(
    //       'PUT /repos/{owner}/{repo}/issues/{issue_number}/labels',
    //       {
    //         owner: github.context.repo.owner,
    //         repo: github.context.repo.repo,
    //         issue_number: pr.number,
    //         labels: newLabels
    //       }
    //     )
    //   } catch (error) {
    //     core.info(`Error parsing ${pr.title} => ${JSON.stringify(error)}`)
    //   }
    // }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
