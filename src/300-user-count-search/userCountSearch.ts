import {readFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {Command} from "@opentr/cuttlecat/dist/graphql/command.js";
import {TaskContext} from "@opentr/cuttlecat/dist/graphql/context.js";
import {Task} from "@opentr/cuttlecat/dist/graphql/task.js";
import {TaskResult} from "@opentr/cuttlecat/dist/graphql/taskResult.js";
import {TaskSpec} from "@opentr/cuttlecat/dist/graphql/taskSpec.js";
import {v4 as uuidv4} from "uuid";
import {LocationsOutput} from "../250-location-generation/locationGeneration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * This task searches for user counts for given search criteria.
 *
 * The search criteria are:
 * - locationJsonFile: Path of the location file. Contents of this file will be used to pass location information in the search query.
 * - minRepos: Minimum number of repositories that the users should have.
 * - minFollowers: Minimum number of followers that the users should have.
 */

export interface UserCountSearchConfig {
    locationJsonFile:string;
    minRepositories:number;
    minFollowers:number;
}

const DEFAULT_CONFIG:UserCountSearchConfig = {
    // ------ CRITERIA - described above --------
    locationJsonFile: join(__dirname, "..", "..", "..", "250-location-generation", "locations.json"),
    minRepositories: 0,
    minFollowers: 0,
};

export interface UserCountSearchTaskResult extends TaskResult {
    search:{
        pageInfo:{
            startCursor:string | null;
            hasNextPage:boolean;
            endCursor:string | null;
        };
        userCount:number;
    };
}

export interface UserCountSearchTaskSpec extends TaskSpec {
    location:string;
    minRepositories:number;
    minFollowers:number;
}

export default class UserCountSearchCommand implements Command<UserCountSearchTaskResult, UserCountSearchTaskSpec, UserCountSearchTask> {
    private readonly config:UserCountSearchConfig;
    private readonly nowFn:() => Date;

    constructor(config?:UserCountSearchConfig, nowFn?:() => Date) {
        this.config = config ?? DEFAULT_CONFIG;
        this.nowFn = nowFn ?? (() => new Date());
    }

    createTask(_:TaskContext, spec:UserCountSearchTaskSpec):UserCountSearchTask {
        return new UserCountSearchTask(spec);
    }

    createNewQueueItems(context:TaskContext):UserCountSearchTaskSpec[] {
        // read JSON file and create an entry for each location
        const locationsOutput:LocationsOutput = JSON.parse(readFileSync(this.config.locationJsonFile, "utf8"));
        const locations:string[] = [];
        for (const key in locationsOutput) {
            locations.push(...locationsOutput[key].alternatives);
        }

        context.logger.info(`Creating a new process state, MIN_REPOS: ${this.config.minRepositories}, MIN_FOLLOWERS: ${this.config.minFollowers}, number of locations: ${locations.length}`);

        const newTaskSpecs:UserCountSearchTaskSpec[] = [];

        for (let i = 0; i < locations.length; i++) {
            const key = uuidv4();
            newTaskSpecs.push({
                id: key,
                parentId: null,
                originatingTaskId: null,
                location: locations[i],
                minRepositories: this.config.minRepositories,
                minFollowers: this.config.minFollowers,
            });
        }

        return newTaskSpecs;
    }
}

export class UserCountSearchTask extends Task<UserCountSearchTaskResult, UserCountSearchTaskSpec> {

    constructor(spec:UserCountSearchTaskSpec) {
        super(spec);
    }

    protected getGraphqlQuery():string {
        return QUERY;
    }

    protected buildQueryParameters(_:TaskContext) {
        const searchString =
            `location:${this.spec.location} ` +
            `repos:>=${this.spec.minRepositories} ` +
            `followers:>=${this.spec.minFollowers}`;

        return {
            "searchString": searchString,
        };
    }

    nextTask(_context:TaskContext, _result:UserCountSearchTaskResult):UserCountSearchTask | null {
        // there won't be any pagination for this task, as it just asks for an aggregate count
        return null;
    }

    narrowedDownTasks(_context:TaskContext):UserCountSearchTask[] | null {
        // there won't be narrowed down tasks for this task, as it just asks for an aggregate count
        return null;
    }

    saveOutput(context:TaskContext, output:UserCountSearchTaskResult):void {
        context.logger.debug(`Saving output of the task: ${this.getId(context)}`);

        context.currentRunOutput.push({
            taskId: this.getId(context),
            result: {
                // we don't have the location returned from the API, so, we need to use the location from the spec
                location: this.spec.location,
                userCount: output.search.userCount,
            },
        });
    }

    /**
     * This task cannot have partial responses as it is an aggregate query.
     * @override
     * @param _
     */
    shouldRecordAsError(_:any):boolean {
        // there can't be partial responses here, so, let's return true, so that the queue can retry this task
        return true;
    }

}

export const QUERY = `
query UserCountSearch($searchString: String!){
    rateLimit {
        cost
        limit
        nodeCount
        remaining
        resetAt
        used
    }
    search(type: USER, query: $searchString, first: 1) {
        userCount
    }
}
`;
