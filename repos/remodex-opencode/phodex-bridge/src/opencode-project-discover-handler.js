// FILE: opencode-project-discover-handler.js
// Purpose: Serves project/discover by syncing OpenCode project.list into the bridge registry.
// Layer: Bridge handler
// Exports: handleOpenCodeProjectDiscoverRequest, projectDiscoverFromOpenCode
// Depends on: ./normalize, ./opencode-runtime-policy

const { readString } = require("./normalize");
const { validateDirectory } = require("./project-path-policy");
const { isOpenCodeRuntimeDisabled } = require("./opencode-runtime-policy");

function handleOpenCodeProjectDiscoverRequest(
  rawMessage,
  sendResponse,
  { homeDir, opencodeProvider, projectRegistry } = {},
) {
  let parsed;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return false;
  }

  const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
  if (method !== "project/discover") {
    return false;
  }

  const id = parsed.id;
  const params = parsed.params || {};

  projectDiscoverFromOpenCode(params, { homeDir, opencodeProvider, projectRegistry })
    .then((result) => {
      sendResponse(JSON.stringify({ id, result }));
    })
    .catch((err) => {
      const errorCode = err.errorCode || "project_discover_failed";
      const message = err.userMessage || err.message || "OpenCode project discovery failed";
      sendResponse(
        JSON.stringify({
          id,
          error: {
            code: -32000,
            message,
            data: { errorCode },
          },
        }),
      );
    });

  return true;
}

async function projectDiscoverFromOpenCode(params, { homeDir, opencodeProvider, projectRegistry } = {}) {
  if (isOpenCodeRuntimeDisabled(process.env)) {
    return { projects: [], source: "opencode", disabled: true };
  }

  if (!opencodeProvider || typeof opencodeProvider.discoverProjects !== "function") {
    throw projectDiscoverError("opencode_unavailable", "OpenCode provider is not available.");
  }

  const directory = readString(params.directory || params.cwd);
  const discoverParams = {};
  if (directory) {
    const validation = await validateDirectory(directory, { homeDir });
    if (!validation.isAllowed) {
      throw projectDiscoverError(
        "path_not_allowed",
        "That folder is outside the allowed local project locations.",
      );
    }
    discoverParams.directory = validation.path;
  }

  const projects = await opencodeProvider.discoverProjects(discoverParams);

  if (projectRegistry && Array.isArray(projects)) {
    for (const project of projects) {
      const projectPath = readString(project.path || project.directory || project.cwd);
      if (!projectPath) {
        continue;
      }
      projectRegistry.rememberProjectPath(projectPath, {
        source: "opencode-project-discover",
        provider: "opencode",
        projectId: readString(project.id || project.projectID || project.projectId),
        label: readString(project.name || project.title || project.label),
      });
    }
  }

  return {
    projects,
    source: "opencode",
    count: Array.isArray(projects) ? projects.length : 0,
  };
}

function projectDiscoverError(errorCode, userMessage) {
  const error = new Error(userMessage);
  error.errorCode = errorCode;
  error.userMessage = userMessage;
  return error;
}

module.exports = {
  handleOpenCodeProjectDiscoverRequest,
  projectDiscoverFromOpenCode,
};
