import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Open the panel to configure roles, channels, and quotas.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ep')
    .setDescription('Event Point commands.')
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show how much EP you or another member has.')
        .addUserOption((o) => o.setName('user').setDescription('Member to check').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Show the top 4 members by EP.'))
    .addSubcommand((s) =>
      s.setName('quotacheck').setDescription('Run the EP quota / strike check (Upper HICOM only).'),
    ),

  new SlashCommandBuilder()
    .setName('op')
    .setDescription('Officer Point commands.')
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show how much OP you or another officer has.')
        .addUserOption((o) => o.setName('user').setDescription('Officer to check').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Show every officer and their OP.'))
    .addSubcommand((s) =>
      s
        .setName('quotacheck')
        .setDescription('Run the OP quota / strike check (Upper HICOM or Officer Overseer).'),
    ),

  new SlashCommandBuilder()
    .setName('assign')
    .setDescription('Assign EP or OP to members.')
    .addSubcommand((s) =>
      s
        .setName('ep')
        .setDescription('Assign EP to one or more members (Officer role required).')
        .addStringOption((o) =>
          o.setName('users').setDescription('Mention or paste the IDs of the members').setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('amount')
            .setDescription('Amount of EP (use a negative number to remove)')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('op')
        .setDescription('Assign OP to one or more officers (HICOM role required).')
        .addStringOption((o) =>
          o.setName('users').setDescription('Mention or paste the IDs of the officers').setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('amount')
            .setDescription('Amount of OP (use a negative number to remove)')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('xp')
        .setDescription('Assign XP to one or more members (HICOM role required).')
        .addStringOption((o) =>
          o.setName('users').setDescription('Mention or paste the IDs of the members').setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('amount')
            .setDescription('Amount of XP (use a negative number to remove)')
            .setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName('xp')
    .setDescription('XP commands.')
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show how much XP you or another member has, and their rank.')
        .addUserOption((o) => o.setName('user').setDescription('Member to check').setRequired(false)),
    ),

  new SlashCommandBuilder()
    .setName('ranks')
    .setDescription('Open the rank management panel (Upper HICOM only).'),

  new SlashCommandBuilder()
    .setName('grouprank')
    .setDescription('Rank a member in the Roblox group.')
    .addUserOption((o) => o.setName('user').setDescription('The Discord user to rank').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('rank')
        .setDescription('The Roblox rank number to assign')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(255),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for the rank change').setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('groupapi')
    .setDescription('Roblox group ranking configuration.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('setup').setDescription('Configure the group ranking system.')),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset everyone’s EP, OP, or both.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());
