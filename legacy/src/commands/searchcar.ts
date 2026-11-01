import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { searchCars, getTopCarImage } from "../utils";

export async function handleSearchCar(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true);
  const results = await searchCars(query);

  if (results.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setTitle("No cars found")
      .setDescription(`No cars found for "${query}".`);
    await interaction.reply({ embeds: [emptyEmbed] });
    return;
  }

  const maxLength = 1800;
  let list = "";
  let shown = 0;

  for (const car of results) {
    const line = `- ${car}\n`;
    if (list.length + line.length > maxLength) break;
    list += line;
    shown += 1;
  }

  list = list.trimEnd();
  const topCar = results[0];
  const imageUrl = topCar ? await getTopCarImage(topCar) : null;

  const embed = new EmbedBuilder()
    .setTitle(`Search results for "${query}"`)
    .setDescription(list)
    .setFooter({ text: `Showing ${shown} of ${results.length} results.` });

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  await interaction.reply({ embeds: [embed] });
}
