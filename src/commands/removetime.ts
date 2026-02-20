import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { getTopCarImage, loadCarData, searchCars } from "../utils";
import { db } from "../database";

export async function handleRemoveTime(interaction: ChatInputCommandInteraction) {
  const raceName = interaction.options.getString("race", true);
  const carQuery = interaction.options.getString("car_query");

  // Check if race exists
  const race = db.query("SELECT id FROM races WHERE name = ?").get(raceName) as { id: string } | null;
  
  if (!race) {
    await interaction.reply({ 
      embeds: [new EmbedBuilder()
        .setTitle("Race Not Found")
        .setDescription(`No race named **${raceName}** exists.`)
        .setColor(0xff0000)
      ],
      ephemeral: true 
    });
    return;
  }

  // Load cars - filter by search query if provided
  let carNames: string[];
  if (carQuery) {
    const searchResults = await searchCars(carQuery);
    if (searchResults.length === 0) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("No Cars Found")
          .setDescription(`No cars found matching "**${carQuery}**"`)
          .setColor(0xff9900)
        ],
        ephemeral: true
      });
      return;
    }
    carNames = searchResults;
  } else {
    const allCars = await loadCarData();
    carNames = allCars.map(car => car.name);
  }

  if (carNames.length === 0) {
    await interaction.reply({ content: "No cars available!", ephemeral: true });
    return;
  }

  let currentIndex = 0;

  const createCarEmbed = async (index: number) => {
    const car = carNames[index];
    if (!car) return new EmbedBuilder().setTitle("Error").setDescription("Car not found");
    
    const imageUrl = await getTopCarImage(car);
    const embed = new EmbedBuilder()
      .setTitle(car)
      .setDescription(
        `Car ${index + 1} of ${carNames.length}\nSelect to remove your time`
      );
    
    if (imageUrl) {
      embed.setImage(imageUrl);
    }
    
    return embed;
  };

  const createButtons = (index: number) => {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("time_reject")
        .setLabel("❌")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("time_accept")
        .setLabel("🗑️ Delete")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("time_prev")
        .setLabel("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId("time_next")
        .setLabel("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index >= carNames.length - 1)
    );
  };

  const embed = await createCarEmbed(currentIndex);
  const row = createButtons(currentIndex);

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300_000,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: "This isn't your time removal!", ephemeral: true });
      return;
    }

    if (i.customId === "time_next") {
      currentIndex = Math.min(currentIndex + 1, carNames.length - 1);
      const newEmbed = await createCarEmbed(currentIndex);
      const newRow = createButtons(currentIndex);
      await i.update({ embeds: [newEmbed], components: [newRow] });
    } else if (i.customId === "time_prev") {
      currentIndex = Math.max(currentIndex - 1, 0);
      const newEmbed = await createCarEmbed(currentIndex);
      const newRow = createButtons(currentIndex);
      await i.update({ embeds: [newEmbed], components: [newRow] });
    } else if (i.customId === "time_accept") {
      const selectedCar = carNames[currentIndex];
      if (!selectedCar) {
        await i.reply({ content: "Error: Car not found", ephemeral: true });
        return;
      }

      // Check if time exists for this player, race, and car
      const existing = db.query(
        "SELECT id FROM times WHERE race_id = ? AND player_id = ? AND car_name = ?"
      ).get(race.id, i.user.id, selectedCar) as { id: number } | null;

      if (!existing) {
        const errorEmbed = new EmbedBuilder()
          .setTitle("No Time Found")
          .setDescription(`You don't have a recorded time for **${selectedCar}** on **${raceName}**`)
          .setColor(0xff9900);
        await i.update({ embeds: [errorEmbed], components: [] });
        collector.stop();
        return;
      }

      // Delete the time
      const deleteStmt = db.prepare("DELETE FROM times WHERE id = ?");
      deleteStmt.run(existing.id);

      const finalEmbed = new EmbedBuilder()
        .setTitle("🗑️ Time Deleted")
        .setDescription(`Your time for **${selectedCar}** on **${raceName}** has been removed.`)
        .setColor(0xff0000);

      const imageUrl = await getTopCarImage(selectedCar);
      if (imageUrl) {
        finalEmbed.setImage(imageUrl);
      }

      await i.update({ embeds: [finalEmbed], components: [] });
      collector.stop();
    } else if (i.customId === "time_reject") {
      const cancelEmbed = new EmbedBuilder()
        .setTitle("Cancelled")
        .setDescription("Time removal cancelled.")
        .setColor(0x3498db);
      await i.update({ embeds: [cancelEmbed], components: [] });
      collector.stop();
    }
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time") {
      const timeoutEmbed = new EmbedBuilder()
        .setTitle("Removal Timed Out")
        .setDescription("You took too long to remove a time.")
        .setColor(0xff9900);
      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    }
  });
}
