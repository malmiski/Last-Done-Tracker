const fs = require('fs');

const path = 'ActivityTracker/src/components/ActivityHistoryItem.tsx';
let content = fs.readFileSync(path, 'utf8');

// Interface
content = content.replace("tags?: Tag[];", "tags?: Tag[];\n  timeSincePrevious?: string;");

// Destructuring props
content = content.replace("tags = []", "tags = [],\n  timeSincePrevious");

// Render text
const textContainerOld = `        <View style={styles.textContainer}>
          <Text style={styles.dateText}>
            {formatDate(startDate)}
            {isDifferentDate ? \` - \${formatDate(endDate)}\` : ''}
          </Text>
          {duration ? <Text style={styles.durationText}>{duration}</Text> : null}`;

const textContainerNew = `        <View style={styles.textContainer}>
          <Text style={styles.dateText}>
            {formatDate(startDate)}
            {isDifferentDate ? \` - \${formatDate(endDate)}\` : ''}
          </Text>
          {duration ? <Text style={styles.durationText}>{duration}</Text> : null}
          {timeSincePrevious ? <Text style={styles.timeSincePreviousText}>{timeSincePrevious}</Text> : null}`;

content = content.replace(textContainerOld, textContainerNew);

// Styles
const stylesOld = `  durationText: {
    color: theme.colors.primary,
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },`;

const stylesNew = `  durationText: {
    color: theme.colors.primary,
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  timeSincePreviousText: {
    color: '#007AFF',
    fontSize: 12,
    marginTop: 2,
  },`;

content = content.replace(stylesOld, stylesNew);

fs.writeFileSync(path, content, 'utf8');
