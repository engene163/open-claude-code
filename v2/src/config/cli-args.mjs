export function parseArgs(args) {
    const result = { prompt: null, model: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--model' || args[i] === '-m') result.model = args[++i];
        else if (args[i] === '-p' || args[i] === '--prompt') result.prompt = args[++i];
        else if (!args[i].startsWith('-')) result.prompt = args[i];
    }
    return result;
}
