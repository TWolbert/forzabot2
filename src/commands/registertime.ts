import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { getTopCarImage, loadCarData, searchCars } from "../utils";
import { db } from "../database";

export async function handleRegisterTime(interaction: ChatInputCommandInteraction) {
  const raceName = interaction.options.getString("race", true);
  const laptimeStr = interaction.options.getString("laptime", true);
  const carQuery = interaction.options.getString("car_query");
  
  // Parse the time string
  const { parseTime } = await import("../utils");
  const laptime = parseTime(laptimeStr);
  
  if (laptime === null) {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle("Invalid Laptime Format")
        .setDescription(`Invalid time format: **${laptimeStr}**\n\nUse format: **MM:SS.MS**\nExamples: \`1:34.860\`, \`12:12.398\`, \`0:45.120\``)
        .setColor(0xff0000)
      ],
      ephemeral: true
    });
    return;
  }

  // Check if race exists
  const race = db.query("SELECT id FROM races WHERE name = ?").get(raceName) as { id: string } | null;
  
  if (!race) {
    await interaction.reply({ 
      embeds: [new EmbedBuilder()
        .setTitle("Race Not Found")
        .setDescription(`No race named **${raceName}** exists. Use /addrace first!`)
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
        `Car ${index + 1} of ${carNames.length}\nLaptime: ${laptime}ms`
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
        .setLabel("✓")
        .setStyle(ButtonStyle.Success),
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
      await i.reply({ content: "This isn't your time registration!", ephemeral: true });
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

      // Check if time already exists for this player, race, and car
      const existing = db.query(
        "SELECT id FROM times WHERE race_id = ? AND player_id = ? AND car_name = ?"
      ).get(race.id, i.user.id, selectedCar) as { id: number } | null;

      let isUpdate = false;
      if (existing) {
        // Update existing time
        const updateStmt = db.prepare(
          "UPDATE times SET laptime = ?, created_at = ? WHERE id = ?"
        );
        updateStmt.run(laptime, Date.now(), existing.id);
        isUpdate = true;
      } else {
        // Insert new time
        const timeStmt = db.prepare(
          "INSERT INTO times (race_id, player_id, car_name, laptime, created_at) VALUES (?, ?, ?, ?, ?)"
        );
        timeStmt.run(race.id, i.user.id, selectedCar, laptime, Date.now());
      }

      // Format laptime for display
      const minutes = Math.floor(laptime / 60000);
      const seconds = Math.floor((laptime % 60000) / 1000);
      const ms = laptime % 1000;
      const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

      const finalEmbed = new EmbedBuilder()
        .setTitle(isUpdate ? "⏱️ Time Updated" : "⏱️ Time Registered")
        .setDescription(`**${selectedCar}** on **${raceName}**`)
        .addFields(
          { name: "Laptime", value: `${timeStr}`, inline: true },
          { name: "Player", value: `<@${i.user.id}>`, inline: true }
        )
        .setColor(isUpdate ? 0x3498db : 0x00ff00);

      const imageUrl = await getTopCarImage(selectedCar);
      if (imageUrl) {
        finalEmbed.setImage(imageUrl);
      }

      await i.update({ embeds: [finalEmbed], components: [] });
      collector.stop();
    } else if (i.customId === "time_reject") {
      const cancelEmbed = new EmbedBuilder()
        .setTitle("Registration Cancelled")
        .setDescription("You didn't register a time.")
        .setColor(0xff0000);
      await i.update({ embeds: [cancelEmbed], components: [] });
      collector.stop();
    }
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time") {
      const timeoutEmbed = new EmbedBuilder()
        .setTitle("Registration Timed Out")
        .setDescription("You took too long to register a time.")
        .setColor(0xff9900);
      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    }
  });
}
