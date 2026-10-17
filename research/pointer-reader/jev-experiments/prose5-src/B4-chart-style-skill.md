---
name: chart-style{{n}}
description: Draws charts for client reports in the firm's style. Use when a request asks for a chart, a graph or a picture of the numbers.{{d}}
---

# Chart style{{n}}

A chart is worth drawing only when it answers a question faster than a table.{{d}} Most clients want three kinds: a bar for months, a line for a balance and a column pair for this year against last year.{{d}}

## Choosing the chart{{n}}

Ask what the reader should see before you pick the kind.{{g}} Write the question in one sentence at the top of your script.{{r}}

| The reader wants to see{{n}} | Draw{{n}} |
|---|---|
| Which month was biggest{{d}} | A bar chart, one bar per month{{r}} |
| How the balance moved{{d}} | A line chart with the zero line marked{{r}} |
| This year against last year{{d}} | Paired columns, same colours every time{{r}} |
| Shares of a total{{d}} | A single stacked bar, never a pie{{p}} |

## Style{{n}}

Use the firm's palette: dark blue for this period, grey for the comparison, orange only for the one thing to look at.{{r}} Do not use more than three colours in one chart.{{p}}

Label the axes in words with the unit, such as euros or number of sales.{{r}} Start bar charts at zero.{{r}} A bar chart that starts above zero tells a false story.{{d}}

Write the chart title as the finding, not the topic.{{r}} Use a title such as sales rose in July and not a title such as monthly sales.{{r}}

## Size and file{{n}}

Draw the chart at 1600 by 900 pixels and save it as a png.{{r}} Use 150 dots per inch.{{r}}

Example call: `fig.set_size_inches(10.67, 6) fig.savefig(out_path, dpi=150, bbox_inches="tight")`.{{e}}

Save the chart in the output folder next to the file it belongs to.{{r}} Use the same naming pattern, with chart as the subject.{{r}}

## Fonts{{n}}

The sandbox has two fonts that always work, a sans serif and a monospace.{{d}} Use the sans serif.{{r}} A font that is not installed falls back silently and changes the look.{{d}}

## Checking the picture{{n}}

Open the finished png and look at it before you say it is done.{{g}} Check that no label is cut off and that the legend does not hide a bar.{{r}}

Describe in one sentence what the chart shows.{{r}} If your sentence does not match the title, redraw the chart.{{r}}

## What not to draw{{n}}

Do not draw a chart for fewer than four numbers; write them in a sentence.{{p}} Do not draw three dimensional charts or shadows.{{p}} Do not draw a second axis unless a partner asked for it.{{p}}

## Accessibility{{n}}

Some clients print in black and white.{{d}} Make sure the bars differ in shade as well as in colour.{{r}}

Add the numbers on top of the bars when there are twelve bars or fewer.{{r}}

Enjoy the drawing.{{n}}
