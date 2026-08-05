import { describe, expect, it } from 'vitest'
import { displayLabel } from '@/components/CallbackLog'
import { field, options } from './helpers'

/**
 * Jobo discovers fields from the DOM, so a `select`'s own option text lands
 * inside the label it sends: "Preferred locations" arrives as
 * "Preferred locations RemoteHo Chi Minh CityNew York". The table shows the
 * options in their own column, so repeating them in the label reads as a
 * rendering bug.
 */
describe('displayLabel', () => {
  it('strips the placeholder option too, which Jobo drops from options[]', () => {
    // Verbatim from a real sandbox callback. `Choose` is
    // <option value="">, so it never appears in options[] and cannot be
    // matched — but it is still in the label.
    expect(
      displayLabel(
        field({
          field_id: 'f0:rcf_8',
          type: 'select',
          label: 'Country ChooseVietnamUnited States',
          options: [
            { value: 'vn', label: 'Vietnam' },
            { value: 'us', label: 'United States' }
          ]
        })
      )
    ).toBe('Country')
  })

  it('peels concatenated option text off a multi_select label', () => {
    expect(
      displayLabel(
        field({
          field_id: 'locations',
          type: 'multi_select',
          label: 'Preferred locations RemoteHo Chi Minh CityNew York',
          options: [
            { value: 'remote', label: 'Remote' },
            { value: 'hcmc', label: 'Ho Chi Minh City' },
            { value: 'nyc', label: 'New York' }
          ]
        })
      )
    ).toBe('Preferred locations')
  })

  it('handles a radio label with two options run together', () => {
    expect(
      displayLabel(
        field({
          field_id: 'authorized',
          type: 'radio',
          label: 'Authorized to work? YesNo',
          options: options('Yes', 'No')
        })
      )
    ).toBe('Authorized to work?')
  })

  it('leaves a clean label alone', () => {
    expect(
      displayLabel(
        field({ field_id: 'country', type: 'select', label: 'Country', options: options('US', 'VN') })
      )
    ).toBe('Country')
  })

  it('leaves fields without options untouched', () => {
    expect(displayLabel(field({ field_id: 'full_name', type: 'text', label: 'Full name' }))).toBe(
      'Full name'
    )
  })

  it('never returns empty when the label is nothing but options', () => {
    // Better to show the noisy original than an empty cell.
    const only = field({
      field_id: 'x',
      type: 'select',
      label: 'YesNo',
      options: options('Yes', 'No')
    })
    expect(displayLabel(only)).toBe('YesNo')
  })

  it('does not strip an option that merely appears mid-label', () => {
    expect(
      displayLabel(
        field({
          field_id: 'remote',
          type: 'select',
          label: 'Remote work preference',
          options: options('Remote', 'Onsite')
        })
      )
    ).toBe('Remote work preference')
  })
})
