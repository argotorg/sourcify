#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { ValidationService, IValidationService } from './ValidationService';
export * from './ValidationService';

if (process.argv.length > 2) {
    const fileNames = process.argv.slice(2);

    let files: any[] = [];
    fileNames.forEach(fileName => {

        try {
            files.push({
                name: fileName,
                data: fs.readFileSync(path.resolve(fileName))
            })
        } catch (error) {
            throw new Error("Can not read file " + fileName);
        }

    });
    const validationService: IValidationService = new ValidationService();
    validationService.checkFiles(files);
}
