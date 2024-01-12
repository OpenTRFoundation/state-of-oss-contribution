import fs from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {Command} from "@opentr/cuttlecat/dist/graphql/command.js";
import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import {Task} from "@opentr/cuttlecat/dist/graphql/task.js";
import {TaskResult} from "@opentr/cuttlecat/dist/graphql/taskResult.js";
import {TaskSpec} from "@opentr/cuttlecat/dist/graphql/taskSpec.js";
import {ProcessFileHelper} from "@opentr/cuttlecat/dist/processFileHelper.js";
import {v4 as uuidv4} from "uuid";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * This task gets the details of focus organizations that have been identified earlier.
 *
 * IMPORTANT:
 * - Given GitHub token must have 'read:org' (and possibly 'public_repo', 'repo:status', 'user:email' and 'read:user') scopes.
 */
export interface FocusOrganizationDetailsConfig {
    // Path to the directory that contains files with the output of the focus project candidate search command.
    // We will find the latest process state directory in this directory.
    focusProjectCandidateSearchDataDirectory:string;

    // Path to the directory that contains files with the output of the focus project extract command.
    // We will read the files from this directory to find the focus organizations.
    focusProjectExtractFilesDir:string;

    // ------ SEARCH tuning --------
    // The page size is the maximum number of repositories to fetch in one call.
    pageSize:number;
}

const DEFAULT_CONFIG:FocusOrganizationDetailsConfig = {
    focusProjectCandidateSearchDataDirectory: join(__dirname, "..", "..", "100-focus-project-candidate-search"),
    focusProjectExtractFilesDir: join(__dirname, "..", "..", "200-focus-project-extract"),

    // ------ SEARCH tuning --------
    pageSize: 25,
};

export interface RepositorySummaryFragment {
    nameWithOwner:string;
    isInOrganization:boolean;
    owner:{
        login:string;
    };
    forkCount:number;
    stargazerCount:number;
    pullRequests:{
        totalCount:number;
    };
    issues:{
        totalCount:number;
    };
    mentionableUsers:{
        totalCount:number;
    };
    watchers:{
        totalCount:number;
    };
    discussions:{
        totalCount:number;
    };
    createdAt:string;
    isPrivate:boolean;
    pushedAt:string;
    visibility:string;
    primaryLanguage:{
        name:string;
    };
    languages:{
        edges:{
            size:number;
            node:{
                name:string;
            };
        }[];
    };
}

export interface FocusOrganizationDetailsTaskResult extends TaskResult {
    organization:{
        login:string;
        name:string;
        createdAt:string;
        membersWithRole:{
            totalCount:number;
        };
        repositories:{
            pageInfo:{
                startCursor:string | null;
                hasNextPage:boolean;
                endCursor:string | null;
            };
            nodes:(RepositorySummaryFragment | null)[];
        };
    }
}

export interface FocusOrganizationDetailsTaskSpec extends TaskSpec {
    orgName:string;
    pageSize:number;
    startCursor:string | null;
}

export default class FocusOrganizationDetailsCommand implements Command<FocusOrganizationDetailsTaskResult, FocusOrganizationDetailsTaskSpec, FocusOrganizationDetailsTask> {
    private readonly config:FocusOrganizationDetailsConfig;
    private readonly nowFn:() => Date;

    constructor(config?:FocusOrganizationDetailsConfig, nowFn?:() => Date) {
        this.config = config ?? DEFAULT_CONFIG;
        this.nowFn = nowFn ?? (() => new Date());
    }

    createTask(_:TaskContext, spec:FocusOrganizationDetailsTaskSpec):FocusOrganizationDetailsTask {
        return new FocusOrganizationDetailsTask(spec);
    }

    createNewQueueItems(context:TaskContext):FocusOrganizationDetailsTaskSpec[] {
        // 1. Read the latest focus orgs search directory name.
        // 2. Read the extract output file for organizations for the latest search directory.
        // 3. Create a task for each organization.

        const logger = context.logger;

        logger.info(`Creating a new process state`);

        if (this.config.focusProjectCandidateSearchDataDirectory == null) {
            throw new Error("focusProjectCandidateSearchDataDirectory is required");
        }

        if (this.config.focusProjectExtractFilesDir == null) {
            throw new Error("focusProjectExtractFilesDir is required");
        }

        const focusProjectCandidateSearchFileHelper = new ProcessFileHelper(this.config.focusProjectCandidateSearchDataDirectory);
        const latestProjectCandidateSearchProcessStateDirectory = focusProjectCandidateSearchFileHelper.getLatestProcessStateDirectory();
        if (!latestProjectCandidateSearchProcessStateDirectory) {
            throw new Error("No latest process state directory found");
        }

        const focusOrganizationsListFile = join(this.config.focusProjectExtractFilesDir, latestProjectCandidateSearchProcessStateDirectory, "focus-organizations.json");
        const focusOrganizationNames = JSON.parse(fs.readFileSync(focusOrganizationsListFile, "utf8")) as string[];

        const newTaskSpecs:FocusOrganizationDetailsTaskSpec[] = [];

        // create tasks for each organization
        for (let i = 0; i < focusOrganizationNames.length; i++) {
            const orgName = focusOrganizationNames[i];
            const newSpec:FocusOrganizationDetailsTaskSpec = {
                id: uuidv4(),
                parentId: null,
                originatingTaskId: null,
                //
                orgName: orgName,
                pageSize: this.config.pageSize,
                startCursor: null,
            };
            newTaskSpecs.push(newSpec);
        }

        return newTaskSpecs;
    }
}

export class FocusOrganizationDetailsTask extends Task<FocusOrganizationDetailsTaskResult, FocusOrganizationDetailsTaskSpec> {

    constructor(spec:FocusOrganizationDetailsTaskSpec) {
        super(spec);
    }

    protected getGraphqlQuery():string {
        return QUERY;
    }

    protected buildQueryParameters(_:TaskContext) {
        return {
            "orgName": this.spec.orgName,
            "first": this.spec.pageSize,
            "after": this.spec.startCursor,
        };
    }

    nextTask(context:TaskContext, result:FocusOrganizationDetailsTaskResult):FocusOrganizationDetailsTask | null {
        // return a new task if there is a next page
        if (result?.organization?.repositories?.pageInfo?.hasNextPage) {
            context.logger.debug(`Next page available for task: ${this.getId(context)}`);
            const newSpec:FocusOrganizationDetailsTaskSpec = {
                id: uuidv4(),
                parentId: null,
                originatingTaskId: this.getId(context),
                //
                orgName: this.spec.orgName,
                pageSize: this.spec.pageSize,
                //
                startCursor: <string>result.organization.repositories.pageInfo.endCursor,
            };

            return new FocusOrganizationDetailsTask(newSpec);
        }

        return null;
    }

    narrowedDownTasks(context:TaskContext):FocusOrganizationDetailsTask[] | null {
        const logger = context.logger;

        // It is fine to create narrowed down tasks even when there is a start cursor.
        // We would end up duplicate repositories in the output, but we can deduplicate them later.
        const newTasks:FocusOrganizationDetailsTask[] = [];

        if(this.spec.pageSize <= 1){
            logger.debug(`Narrowed down tasks can't be created for task ${this.getId(context)} as pageSize is too small.`);
            return null;
        }
        const halfPageSize = Math.floor(this.spec.pageSize / 2);

        const newSpec:FocusOrganizationDetailsTaskSpec = {
            id: uuidv4(),
            parentId: this.getId(context),
            originatingTaskId: this.spec.originatingTaskId,
            //
            orgName: this.spec.orgName,
            //
            pageSize: halfPageSize,
            //
            startCursor: this.spec.startCursor,
        };
        newTasks.push(new FocusOrganizationDetailsTask(newSpec));

        return newTasks;
    }

    saveOutput(context:TaskContext, output:FocusOrganizationDetailsTaskResult):void {
        const logger = context.logger;

        logger.debug(`Saving output of the task: ${this.getId(context)}`);

        const orgDetails = output.organization;

        context.currentRunOutput.push({
            taskId: this.getId(context),
            result: orgDetails,
        });
    }

}

// ideally, we would want to filter open and merged PRs, but that makes the API timeout
// pullRequests(states:[OPEN, MERGED]){
export const QUERY = `
query FocusOrganizationDetails($orgName: String!, $first: Int!, $after:String) {
    rateLimit{
      cost
      limit
      nodeCount
      remaining
      resetAt
      used
    }
    organization(login:$orgName) {
      login
      name,
      createdAt,
      membersWithRole{
        totalCount
      }
      repositories(privacy: PUBLIC, first:$first, after:$after){
        pageInfo{
          endCursor,
          hasNextPage
        }
        nodes{
          ...RepositorySummary
        }
      }
    }
}
fragment RepositorySummary on Repository{
  nameWithOwner,
  isInOrganization
  owner{
      login
  }
  forkCount,
  stargazerCount,
  pullRequests{
    totalCount
  },
  issues{
      totalCount
  }
  mentionableUsers{
      totalCount
  }
  watchers{
      totalCount
  }
  discussions{
    totalCount
  },    
  createdAt,
  isPrivate,
  pushedAt,
  visibility,
  primaryLanguage{
    name
  },
  languages(first:100){
    edges{
      size
      node{
        name
      }
    }
  }
}
`;
