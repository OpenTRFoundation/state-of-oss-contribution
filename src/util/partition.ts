import * as fs from "fs";
import * as path from "path";

type PartitionIndex = {
    fileCount:number;
    files:string[];
};

const IndexFileNameSuffix = ".index.json";

function stringify(data:any) {
    return JSON.stringify(data, null, 2);
}

export function writePartitioned(directory:string, baseName:string, keyCountPerPartition:number, data:{
    [key:string]:any
}) {
    // NOTE: this is a very naive implementation that's not optimized for performance at all!!

    const partitionCount = Math.ceil(Object.keys(data).length / keyCountPerPartition);
    const files:string[] = [];

    for (let partitionIndex = 0; partitionIndex < partitionCount; partitionIndex++) {
        const partitionData:{ [key:string]:any } = {};
        const partitionStart = partitionIndex * keyCountPerPartition;
        const partitionEnd = partitionStart + keyCountPerPartition;
        const partitionKeys = Object.keys(data).slice(partitionStart, partitionEnd);
        for (const key of partitionKeys) {
            partitionData[key] = data[key];
        }
        const partitionIndexWithZeroes = partitionIndex.toString().padStart(partitionCount / 10 + 1, "0");
        const partitionFileName = `${baseName}.${partitionIndexWithZeroes}.json`;
        const partitionFilePath = path.join(directory, partitionFileName);
        fs.writeFileSync(partitionFilePath, stringify(partitionData));
        files.push(partitionFileName);
    }

    const partitionIndex:PartitionIndex = {
        fileCount: partitionCount,
        files: files,
    };
    const partitionIndexFileName = `${baseName}${IndexFileNameSuffix}`;
    const partitionIndexFilePath = path.join(directory, partitionIndexFileName);
    fs.writeFileSync(partitionIndexFilePath, stringify(partitionIndex));
}

export function readPartitioned(directory:string, indexFile:string) {
    // NOTE: this is a very naive implementation that's not optimized for performance at all!!

    const partitionIndexFilePath = path.join(directory, indexFile);
    const partitionIndex:PartitionIndex = JSON.parse(fs.readFileSync(partitionIndexFilePath, "utf8"));
    const data:{ [key:string]:any } = {};
    for (const partitionFileName of partitionIndex.files) {
        const partitionFilePath = path.join(directory, partitionFileName);
        const partitionData:{ [key:string]:any } = JSON.parse(fs.readFileSync(partitionFilePath, "utf8"));
        for (const key of Object.keys(partitionData)) {
            data[key] = partitionData[key];
        }
    }
    return data;
}
