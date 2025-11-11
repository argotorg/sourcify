import type { Response, Request } from "express";
import { StatusCodes } from "http-status-codes";

/**
 * Function to find the latest run of the test-chains-regularly workflow. Fetches the identifiers of the run. Also fetches the artifact .json of the run. Returns the artifact and the identifiers.
 *
 * See API docs: https://circleci.com/docs/api/v2
 *
 * @returns the testReport artifact, jobNumber, workflowId, and the pipelineNumber of the last run of the workflow.
 */
export async function findLatestChainTest(req: Request, res: Response) {
  const CIRCLE_PROJECT_ID = process.env.CIRCLE_PROJECT_ID || 183183290;
  const WORKFLOWS_URL = `https://circleci.com/api/v2/insights/gh/argotorg/sourcify/workflows/test-chains-regularly?branch=master`;
  // Fetch last runs of the chain test workflow: https://circleci.com/docs/api/v2/#operation/getProjectWorkflowRuns
  const workflowResponse = await (await fetch(WORKFLOWS_URL)).json();
  if (workflowResponse.items.length === 0) {
    res
      .status(StatusCodes.NOT_FOUND)
      .json({ error: "No workflows returned from " + WORKFLOWS_URL });
    return;
  }
  const workflowId = workflowResponse.items[0].id;

  const LAST_WORKFLOW_URL = `https://circleci.com/api/v2/workflow/${workflowId}`;
  const JOB_URL = `https://circleci.com/api/v2/workflow/${workflowId}/job`;

  // Run requests in parallel.
  const [lastWorkflowResponse, jobResponse] = await Promise.all([
    // Fetch the last workflow object to get the pipeline number
    (await fetch(LAST_WORKFLOW_URL)).json(),
    // Fetch the job of the last workflow for the job number
    (await fetch(JOB_URL)).json(),
  ]);
  const pipelineNumber = lastWorkflowResponse.pipeline_number;
  const jobNumber = jobResponse.items[0].job_number;
  const jobId = jobResponse.items[0].id;
  // Fetch the test report .json artifact
  const ARTIFACT_URL = `https://dl.circleci.com/private/output/job/${jobId}/artifacts/0/services/server/chain-tests-report/report.json`;
  const artifactResponse = await fetch(ARTIFACT_URL);
  const artifactResponseJson = await artifactResponse.json();
  if (!artifactResponse.ok) {
    res.status(artifactResponse.status).json(artifactResponseJson);
    return;
  }

  res.json({
    testReport: artifactResponseJson,
    workflowId,
    pipelineNumber,
    jobNumber,
    jobId,
    CIRCLE_PROJECT_ID,
  });
}
