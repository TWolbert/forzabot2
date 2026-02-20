import { Client, ChatInputCommandInteraction } from "discord.js";
import { handlePing, handleForza } from "./basic";
import { handleSearchCar } from "./searchcar";
import { handleChooseCar } from "./choosecar";
import { handleStartRound } from "./startround";
import { handleGameStart } from "./gamestart";
import { handleStats } from "./stats";
import { handlePastRaces } from "./pastraces";
import { handleAddRace } from "./addrace";
import { handleRegisterTime } from "./registertime";
import { handleTimes } from "./times";
import { handleListRace } from "./listrace";

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  client: Client
) {
  switch (interaction.commandName) {
    case "ping":
      await handlePing(interaction);
      break;
    case "forza":
      await handleForza(interaction);
      break;
    case "searchcar":
      await handleSearchCar(interaction);
      break;
    case "choosecar":
      await handleChooseCar(interaction);
      break;
    case "startround":
      await handleStartRound(interaction);
      break;
    case "gamestart":
      await handleGameStart(interaction, client);
      break;
    case "stats":
      await handleStats(interaction);
      break;
    case "pastraces":
      await handlePastRaces(interaction);
      break;
    case "addrace":
      await handleAddRace(interaction);
      break;
    case "registertime":
      await handleRegisterTime(interaction);
      break;
    case "times":
      await handleTimes(interaction);
      break;
    case "listrace":
      await handleListRace(interaction);
      break;
    default:
      await interaction.reply({ content: "Unknown command", ephemeral: true });
  }
}
