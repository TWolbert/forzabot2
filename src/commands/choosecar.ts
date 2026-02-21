import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { searchCars, getTopCarImage, loadCarData } from "../utils";
import { db } from "../database";

export async function handleChooseCar(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query");
  const isRandom = interaction.options.getBoolean("random") ?? false;

  if (!query && !isRandom) {
    await interaction.reply({ content: "Please provide a car query or enable random selection.", ephemeral: true });
    return;
  }

  // Get the most recent pending or active round
  const round = db.query(
    "SELECT id, value FROM rounds WHERE status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1"
  ).get() as { id: string; value: number } | null;

  const maxValue = round?.value;
  
  // Handle random car selection
  if (isRandom) {
    if (!round) {
      await interaction.reply({ content: "No active round found. Please start a round first.", ephemeral: true });
      return;
    }

    // Load all cars and filter by budget
    const allCars = await loadCarData();
    const validCars = allCars
      .filter(car => !maxValue || car.value <= maxValue)
      .map(car => car.name);

    if (validCars.length === 0) {
      await interaction.reply({ 
        embeds: [new EmbedBuilder()
          .setTitle("No cars available")
          .setDescription(`No cars found within ${maxValue ? `$${maxValue.toLocaleString("en-US")}` : "budget"} budget.`)
        ], 
        ephemeral: true 
      });
      return;
    }

    const randomIndex = Math.floor(Math.random() * validCars.length);
    const selectedCar = validCars[randomIndex];

    // Save car choice to database (override previous selection if any)
    const clearStmt = db.prepare(
      "DELETE FROM car_choices WHERE round_id = ? AND player_id = ?"
    );
    clearStmt.run(round.id, interaction.user.id);

    const carChoiceStmt = db.prepare(
      "INSERT INTO car_choices (round_id, player_id, car_name, chosen_at) VALUES (?, ?, ?, ?)"
    );
    carChoiceStmt.run(round.id, interaction.user.id, selectedCar, Date.now());

    const finalEmbed = new EmbedBuilder()
      .setTitle("🎲 Random Car Selected")
      .setDescription(`You got: **${selectedCar}**\nRound ID: ${round.id}`)
      .setColor(0x9b59b6);

    const imageUrl = await getTopCarImage(selectedCar);
    if (imageUrl) {
      finalEmbed.setImage(imageUrl);
    }

    await interaction.reply({ embeds: [finalEmbed] });
    return;
  }

  const results = await searchCars(query!, maxValue);

  if (results.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setTitle("No cars found")
      .setDescription(
        maxValue 
          ? `No cars found for "${query}" within $${maxValue.toLocaleString("en-US")} budget.`
          : `No cars found for "${query}".`
      );
    await interaction.reply({ embeds: [emptyEmbed], ephemeral: true });
    return;
  }

  let currentIndex = 0;

  const formatCurrency = (value: number): string =>
    `$${value.toLocaleString("en-US")}`;

  const createCarEmbed = async (index: number) => {
    const car = results[index];
    if (!car) return new EmbedBuilder().setTitle("Error").setDescription("Car not found");
    
    const imageUrl = await getTopCarImage(car);
    const embed = new EmbedBuilder()
      .setTitle(car)
      .setDescription(
        maxValue
          ? `Car ${index + 1} of ${results.length} (Max: ${formatCurrency(maxValue)})`
          : `Car ${index + 1} of ${results.length}`
      );
    
    if (imageUrl) {
      embed.setImage(imageUrl);
    }
    
    return embed;
  };

  const createButtons = (index: number) => {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("car_reject")
        .setLabel("❌")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("car_accept")
        .setLabel("✓")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("car_prev")
        .setLabel("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId("car_next")
        .setLabel("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index >= results.length - 1)
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
      await i.reply({ content: "This isn't your car selection!", ephemeral: true });
      return;
    }

    if (i.customId === "car_next") {
      currentIndex = Math.min(currentIndex + 1, results.length - 1);
      const newEmbed = await createCarEmbed(currentIndex);
      const newRow = createButtons(currentIndex);
      await i.update({ embeds: [newEmbed], components: [newRow] });
    } else if (i.customId === "car_prev") {
      currentIndex = Math.max(currentIndex - 1, 0);
      const newEmbed = await createCarEmbed(currentIndex);
      const newRow = createButtons(currentIndex);
      await i.update({ embeds: [newEmbed], components: [newRow] });
    } else if (i.customId === "car_accept") {
      const selectedCar = results[currentIndex];
      if (!selectedCar) {
        await i.reply({ content: "Error: Car not found", ephemeral: true });
        return;
      }

      // Get the most recent round ID
      const recentRound = db.query(
        "SELECT id FROM rounds WHERE status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1"
      ).get() as { id: string } | null;
      
      if (!recentRound) {
        await i.update({ content: "No active round found. Please start a round first.", embeds: [], components: [] });
        collector.stop();
        return;
      }

      // Save car choice to database (override previous selection if any)
      const clearStmt = db.prepare(
        "DELETE FROM car_choices WHERE round_id = ? AND player_id = ?"
      );
      clearStmt.run(recentRound.id, i.user.id);

      const carChoiceStmt = db.prepare(
        "INSERT INTO car_choices (round_id, player_id, car_name, chosen_at) VALUES (?, ?, ?, ?)"
      );
      carChoiceStmt.run(recentRound.id, i.user.id, selectedCar, Date.now());

      const finalEmbed = new EmbedBuilder()
        .setTitle("Car Selected")
        .setDescription(`You selected: **${selectedCar}**\nRound ID: ${recentRound.id}`)
        .setColor(0x00ff00);

      const imageUrl = await getTopCarImage(selectedCar);
      if (imageUrl) {
        finalEmbed.setImage(imageUrl);
      }

      await i.update({ embeds: [finalEmbed], components: [] });
      collector.stop();
    } else if (i.customId === "car_reject") {
      const cancelEmbed = new EmbedBuilder()
        .setTitle("Selection Cancelled")
        .setDescription("You didn't select a car.")
        .setColor(0xff0000);
      await i.update({ embeds: [cancelEmbed], components: [] });
      collector.stop();
    }
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time") {
      const timeoutEmbed = new EmbedBuilder()
        .setTitle("Selection Timed Out")
        .setDescription("You took too long to select a car.")
        .setColor(0xff9900);
      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    }
  });
}
