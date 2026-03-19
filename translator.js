import getArgs from "@cloudwell/process-args"
import axios from "axios"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { dirname, extname } from "path"
import * as dotenv from "dotenv"

dotenv.config();

const apiKey = process.env.API_KEY;

async function apiCall(method, api, params, data) {
    const maxRetries = 5
    let attempt = 0

    while (attempt < maxRetries) {
        try {
            return await axios({
                method: method,
                url: `https://api.cognitive.microsofttranslator.com/${api}?api-version=3.0`,
                params: params,
                headers: {
                    "Ocp-Apim-Subscription-Key": apiKey,
                    "Ocp-Apim-Subscription-Region": "eastus",
                    "Content-Type": "application/json"
                },
                data: data
            })
        } catch (error) {
            if (error.response && error.response.status === 429) {
                const retryAfter = error.response.headers["retry-after"] || 1
                console.warn(`Throttled. Retrying after ${retryAfter} seconds...`)
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
                attempt++
            } else {
                throw error
            }
        }
    }

    throw new Error(`API call failed after ${maxRetries} attempts due to throttling.`)
}

async function getSupportedLanguages() {
    const languages = []
    const response = await apiCall("GET", "languages", { scope: "translation" })
    for (const key of Object.keys(response.data.translation)) {
        const language = key.split("-")[0]
        if (language && !languages.includes(language)) {
            languages.push(language)
        }
    }
    return languages
}

async function translateString(text, to) {
    if (!text || typeof text !== "string" || text.trim().length === 0) {
        throw new Error("ERROR: Invalid text parameter")
    }

    if (!to || typeof to !== "string" || to.trim().length === 0) {
        throw new Error("ERROR: Invalid to parameter")
    }

    try {
        const response = await apiCall("POST", "translate", { from: sourceLanguage, to }, [{ text }])

        // replace smart quotes with regular quotes to avoid JSON parse errors
        const translatedString = response.data[0].translations[0].text
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')

        if (!translatedString || typeof translatedString !== "string" || translatedString.trim().length === 0) {
            console.log("ERROR: No translated string returned")
            return
        }

        return translatedString
    } catch (error) {
        throw new Error(`ERROR: Failed to translate string "${text}" to "${to}": ${error.message}`)
    }
}

async function localize() {
    if (!apiKey) {
        throw new Error("ERROR: Azure Translate API key is not set");
    }

    if (!existsSync(file)) {
        throw new Error(`ERROR: The source file does not exist: ${file}`);
    }

    const folder = dirname(file);
    const ext = extname(file).toLowerCase();

    let sourceContent = [];

    readFileSync(file, "utf-8").split("\n").forEach(line => {
        sourceContent.push(line);
    });

    const supportedLanguages = await getSupportedLanguages();
    if (supportedLanguages.length === 0) {
        return;
    }

    for (const targetLanguage of targetLanguages) {
        if (supportedLanguages.some(l => targetLanguage.startsWith(l))) {
            let targetContent = [];
            const targetFilePath = `${folder}/${targetLanguage}${ext}`;

            let numberOfLinesTranslated = 0;

            for (const sourceString of sourceContent) {
                if (sourceString.trim().length === 0) {
                    targetContent.push(sourceString);
                    continue;
                }
                try {
                    const translatedString = await translateString(sourceString, targetLanguage);
                    targetContent.push(translatedString);
                    numberOfLinesTranslated++;
                } catch (error) {
                    console.warn("Error translating text: ", { language: targetLanguage, text: sourceString, error });
                }
            }

            if (numberOfLinesTranslated > 0) {
                try {
                    writeFileSync(targetFilePath, targetContent.join("\n"), "utf8");
                    console.log(`Successfully saved ${numberOfLinesTranslated} translated line${numberOfLinesTranslated > 1 ? "s" : ""} to the ${targetLanguage} language file!`);
                } catch (error) {
                    throw new Error(`Failed to save the ${targetLanguage} language file: ${error.message}`);
                }
            } else {
                console.log(`The ${targetLanguage} language file was up-to-date.`);
            }
        } else {
            console.warn(`Skipping unsupported language: ${targetLanguage}`);
        }
    }
}

function printHelp() {
    const fileName = process.argv.slice(1, 2);
    console.log("Summary: This script uses Azure Cognitive Services to translate a file from one language to multiple others.");
    console.log('\nParameters:');
    console.log('  -l[ist]: List all supported languages');
    console.log('  -f[ile]: The path to the input file');
    console.log('  -s[ource]: The source language (default: "en-us")');
    console.log('  -t[arget]: The target languages (comma-separated)');
    console.log('\nExample: Translate the input file to "fr-fr" and "it-it" language files.');
    console.log(`  node ${fileName} -f ./input.txt -t fr-fr,it-it`);
    console.log("\nExample: List all supported languages.");
    console.log(`  node ${fileName} -list`);
    console.log(`  node ${fileName} -l`);
    console.log("\nExample: Print this help.");
    console.log(`  node ${fileName} -help`);
    console.log(`  node ${fileName} -h`);
    console.log("");
    process.exit(1);
}

console.log("");

const listArgs = ["t", "target"];
const args = getArgs({
    getParser: argument => {
        if (listArgs.some(x => x === argument)) {
            return value => (value ? value.split(",") : []);
        }
    }
});

const file = args.f || args.file;
const sourceLanguage = args.s || args.source || "en-us";
const targetLanguages = args.t || args.target || [];

if (args.help) {
    printHelp();
}

if (args.l || args.list) {
    console.log("Supported Languages:");
    const languages = await getSupportedLanguages();
    (languages || []).forEach(language => {
        console.log(language)
    });
    process.exit(0);
}

if (!file || !targetLanguages.length) {
    printHelp();
}

try {
    await localize();
} catch (err) {
    throw new Error("Localize Failed: " + err.message);
}