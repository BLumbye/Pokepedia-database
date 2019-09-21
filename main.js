// Import node packages
const axios = require("axios");
const mongoose = require("mongoose");
mongoose.connect("mongodb://localhost/pokepedia", { useNewUrlParser: true });


// Set variables
const apiUrl = "https://pokeapi.co/api/v2";

// Timeout function for async/await
function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to retry getting the info
const axios_retry = async (url, delay, n) => {
  try {
    return await axios.get(url);
  } catch (err) {
    if (n === 1) throw err;
    await timeout(delay);
    return await axios_retry(url, delay, n);
  }
};

function mapEvolvesTo(raw) {
  return raw.map(r => {
    return {
      is_baby: r.is_baby,
      species: r.species.name,
      evolution_details: r.evolution_details.map(e => {
        return {
          item: e.item !== null ? e.item.name : null,
          gender: e.gender,
          held_item: e.held_item !== null ? e.held_item.name : null,
          known_move: e.known_move !== null ? e.known_move.name : null,
          known_move_type: e.known_move_type !== null ? e.known_move_type.name : null,
          location: e.location !== null ? e.location.name : null,
          min_level: e.min_level,
          min_happiness: e.min_happiness,
          min_beauty: e.min_beauty,
          min_affection: e.min_affection,
          needs_overworld_rain: e.needs_overworld_rain,
          party_species: e.party_species !== null ? e.party_species.name : null,
          party_type: e.party_type !== null ? e.party_type.name : null,
          relative_physical_stats: e.relative_physical_stats,
          time_of_day: e.time_of_day,
          turn_upside_down: e.turn_upside_down,
          trigger: e.trigger.name,
        };
      }),
      evolves_to: r.evolves_to.length ? mapEvolvesTo(r.evolves_to) : null,
    };
  });
}

async function loadPokemonSpecies() {
  // Create mongoose schemas
  const evolvesToSchema = new mongoose.Schema();
  evolvesToSchema.add({
    is_baby: Boolean,
    species: String,
    evolution_details: [{
      item: String,
      gender: Number,
      held_item: String,
      known_move: String,
      known_move_type: String,
      location: String,
      min_level: Number,
      min_happiness: Number,
      min_beauty: Number,
      min_affection: Number,
      needs_overworld_rain: Boolean,
      party_species: String,
      party_type: String,
      relative_physical_stats: Number,
      time_of_day: String,
      turn_upside_down: Boolean,
      trigger: String,
    }],
    evolvesTo: [evolvesToSchema],
  });

  const evolutionChainSchema = new mongoose.Schema({
    id: Number,
    baby_trigger_item: String,
    chain: {
      is_baby: Boolean,
      species: String,
      evolves_to: [evolvesToSchema],
    }
  });

  const pokemonSchema = new mongoose.Schema({
    name: { type: String, unique: true, required: true },
    sprites: {
      back_default: String,
      back_female: String,
      back_shiny: String,
      back_shiny_female: String,
      front_default: String,
      front_female: String,
      front_shiny: String,
      front_shiny_female: String
    },
    id: { type: Number, unique: true, required: true },
    type: {
      primary: String,
      secondary: String
    },
    genus: String,
    height: Number,
    weight: Number,
    abilities: [String],
    base_experience: Number,
    growth_rate: String,
    egg_groups: [String],
    gender_rate: Number,
    egg_cycles: Number,
    generation: Number,
    stats: [{ base_stat: Number, effort: Number, name: String }],
    evolution_chain: evolutionChainSchema,
    held_items: [String],
    moves: [String],
    pokedex_entry: String,
    shape: String
  });

  // Make mongoose model
  const Pokemon = mongoose.model('Pokemon', pokemonSchema);

  // Load the full list of endpoints to load pokemon information from
  let response = await axios.get(`${apiUrl}/pokemon-species/?limit=1000`);

  /* Load these things in for each species
        Picture of the chosen pokémon / alternative forms
        National pokédex number
        Type
        Genus
        Height
        Weight
        Abilities
        Base exp
        Growth rate
        Egg groups
        Gender rate
        Egg cycles
        Generation
        Stats
        Evolution chart - what info?
        Held items
        Moves
        Pokédex entries - newest version
        Shape
    */
  let i;
  for (i = 0; i < response.data.results.length; i++) {
    try {
      let speciesResult = await axios_retry(
        response.data.results[i].url,
        10000,
        10
      );
      let speciesData = speciesResult.data;
      let pokemonResult = await axios_retry(
        speciesData.varieties[0].pokemon.url,
        10000,
        10
      );
      let pokemonData = pokemonResult.data;
      let evolutionResult = await axios_retry(
        speciesData.evolution_chain.url,
        10000,
        10
      );
      let evolutionData = evolutionResult.data;

      const pokemon = new Pokemon({
        name: speciesData.name,
        sprites: pokemonData.sprites,
        id: speciesData.id,
        type: {
          primary: pokemonData.types.find(t => t.slot == 1).type.name,
          secondary:
            pokemonData.types.length == 2
              ? pokemonData.types.find(t => t.slot == 2).type.name
              : null
        },
        genus: speciesData.genera.find(g => g.language.name === "en").genus,
        height: pokemonData.height,
        weight: pokemonData.weight,
        abilities: pokemonData.abilities.map(a => a.ability.name),
        base_experience: pokemonData.base_experience,
        growth_rate: speciesData.growth_rate.name,
        egg_groups: speciesData.egg_groups.map(e => e.name),
        gender_rate: speciesData.gender_rate, // number of eigths that are female
        egg_cycles: speciesData.hatch_counter,
        generation: parseInt(speciesData.generation.url.match(/\/([0-9]*)\/$/)[1]),
        stats: pokemonData.stats.map(s => {
          return {
            base_stat: s.base_stat,
            effort: s.effort,
            name: s.stat.name
          };
        }),
        evolution_chain: {
          id: evolutionData.id,
          baby_trigger_item:
            evolutionData.baby_trigger_item !== null 
              ? evolutionData.baby_trigger_item.name
              : null,
          chain: {
            is_baby: evolutionData.chain.is_baby,
            species: evolutionData.chain.species.name,
            evolves_to: mapEvolvesTo(evolutionData.chain.evolves_to),
          }
        },
        held_items: pokemonData.held_items.map(h => h.item.name),
        moves: pokemonData.moves.map(m => m.move.name),
        // Entries are already sorted by version - we just need to find the first one in english
        pokedex_entry: speciesData.flavor_text_entries
          .find(f => f.language.name === "en")
          .flavor_text.replace(/\n/g, " "),
        shape: speciesData.shape.name
      });

      // Pokemon.findOneAndUpdate({id: pokemon.id}, pokemon, {upsert: true}, (err, p) => {
      //   if (err) console.error(err);
      //   console.log(p, i);
      // });
      pokemon.save((err, p) => {
        if (err) console.error(err);
        console.log(p, i);
      });
    } catch (err) {
      console.error(err);
    }
  }
  console.log("fetched " + i);
  process.exit();
}

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
  loadPokemonSpecies();
})
