import { REST, Routes, ApplicationCommandType } from "discord.js";

const commands = [
  {
    name: "ping",
    description: "Replies with Pong!",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "forza",
    description: "tests forzabot",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "searchcar",
    description: "Search cars by name",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "query",
        description: "Search text",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "choosecar",
    description: "Search and choose a car interactively",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "query",
        description: "Search text",
        type: 3,
        required: false,
      },
      {
        name: "random",
        description: "Select a random car within budget",
        type: 5,
        required: false,
      },
    ],
  },
  {
    name: "startround",
    description: "Start a new Forza round",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "player1",
        description: "Player 1",
        type: 6,
        required: true,
      },
      {
        name: "player2",
        description: "Player 2",
        type: 6,
        required: true,
      },
      {
        name: "race_type",
        description: "Choose a race type",
        type: 3,
        required: false,
        choices: [
          { name: "Rally", value: "rally" },
          { name: "Goliath", value: "goliath" },
          { name: "Circuit", value: "circuit" },
          { name: "Drag", value: "drag" },
          { name: "Offroad", value: "offroad" },
          { name: "All", value: "all" },
        ],
      },
      {
        name: "year",
        description: "Restrict to a specific model year",
        type: 4,
        required: false,
      },
      {
        name: "player3",
        description: "Player 3",
        type: 6,
        required: false,
      },
      {
        name: "player4",
        description: "Player 4",
        type: 6,
        required: false,
      },
      {
        name: "player5",
        description: "Player 5",
        type: 6,
        required: false,
      },
      {
        name: "player6",
        description: "Player 6",
        type: 6,
        required: false,
      },
      {
        name: "player7",
        description: "Player 7",
        type: 6,
        required: false,
      },
      {
        name: "player8",
        description: "Player 8",
        type: 6,
        required: false,
      },
      {
        name: "restrict_class",
        description: "Restrict to a specific car class (default: true)",
        type: 5,
        required: false,
      },
    ],
  },
  {
    name: "gamestart",
    description: "Start the game with all players locked in",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "stats",
    description: "View player statistics and leaderboard",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "player",
        description: "Player to view stats for (or 'all' for leaderboard)",
        type: 6,
        required: false,
      },
    ],
  },
  {
    name: "pastraces",
    description: "View past races",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "limit",
        description: "Number of races to show",
        type: 4,
        required: false,
      },
    ],
  },
  {
    name: "addrace",
    description: "Add a new race/track",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "name",
        description: "Name of the race/track",
        type: 3,
        required: true,
      },
      {
        name: "description",
        description: "Description of the race",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "registertime",
    description: "Register a laptime for a race",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "race",
        description: "Name of the race/track",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "laptime",
        description: "Laptime in format MM:SS.MS (e.g., 1:34.860 or 12:12.398)",
        type: 3,
        required: true,
      },
      {
        name: "car_query",
        description: "Search for a specific car (optional)",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "times",
    description: "View recorded times",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "race",
        description: "Filter by race name",
        type: 3,
        required: false,
      },
      {
        name: "car",
        description: "Filter by car name",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "listrace",
    description: "List all available races/tracks",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "removetime",
    description: "Remove a recorded lap time",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "race",
        description: "Name of the race/track",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "car_query",
        description: "Search for a specific car (optional)",
        type: 3,
        required: false,
      },
    ],
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN!);

try {
  console.log("Started refreshing application (/) commands.");

  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
    body: commands,
  });

  console.log("Successfully reloaded application (/) commands.");
} catch (error) {
  console.error(error);
}
